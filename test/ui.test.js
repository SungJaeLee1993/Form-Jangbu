'use strict';
// 브라우저에서 화면 전체를 눌러보는 스모크 테스트 (Electron API는 가짜로 대신함)
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { }
const { parseWorkbook } = require('../src/importer');

async function open(withApi) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  if (withApi) {
    const { fakeLedger, fakeSales } = require('./importer.test.js');
    const parsed = [parseWorkbook(fakeLedger(), 'a.xls'), parseWorkbook(fakeSales(), 'b.xls')];
    await p.addInitScript(parsed => {
      let store = null, n = 0;
      window.api = {
        load: async () => store, save: async s => { store = s; return true; }, info: async () => ({ version: 'test', dataDir: '-', backups: [] }),
        importXls: async () => parsed[n++ % parsed.length], exportXlsx: async () => true, printPDF: async () => true, printPaper: async () => true,
        aiRead: async () => ({ ok: true, lines: [{ raw: '오이 5개', name: '청오이(국내산)ea', qty: 5 }] }), logError: async () => true, onUpdate: () => { }
      };
    }, parsed);
  }
  await p.goto('file://' + path.join(__dirname, '..', 'renderer', 'index.html'));
  await p.waitForSelector('nav button');
  return { b, p, errs };
}

test('모든 화면이 오류 없이 뜨고 핵심 흐름이 동작', { skip: !chromium && 'playwright 없음' }, async () => {
  const { b, p, errs } = await open(false);
  for (const v of ['orders', 'purchase', 'external', 'statement', 'settle', 'settings', 'home']) { await p.click(`nav [data-v="${v}"]`); }
  await p.click('nav [data-v="settings"]');
  for (const t of ['import', 'centers', 'items', 'margin', 'etc', 'freshone', 'ai', 'backup']) await p.click(`[data-a="setTab"][data-v="${t}"]`);
  // 전화: 초성 검색 → 엔터 → 수량 → 엔터
  await p.click('nav [data-v="orders"]');
  const before = await p.$$eval('.ord-grid > .card tbody tr', r => r.length);
  await p.fill('#ph-q', 'ㅅㄱㅊ'); await p.dispatchEvent('#ph-q', 'input');
  assert.match(await p.textContent('#ph-res'), /시금치/);
  await p.press('#ph-q', 'Enter'); await p.fill('#ph-qty', '3'); await p.press('#ph-qty', 'Enter');
  // 카톡
  await p.click('[data-a="setIntake"][data-v="카톡"]');
  await p.fill('#kk', '[원장] [오전 9:10] 미역 2키로\n양지 1.5kg\n계란 두판\n알수없는것 3개'); await p.dispatchEvent('#kk', 'input');
  assert.strictEqual(await p.$$eval('#rv tbody tr', r => r.length), 4);
  assert.strictEqual(await p.inputValue('[data-rq="2"]'), '2');
  await p.click('[data-a="rvAdd"]');
  const after = await p.$$eval('.ord-grid > .card tbody tr', r => r.length);
  assert.ok(after >= before + 3, `lines ${before}→${after}`);
  // 사진 탭은 API 없으면 안내만
  await p.click('[data-a="setIntake"][data-v="사진"]');
  // 외부 구매
  await p.click('nav [data-v="external"]');
  await p.fill('#x-name', '활전복'); await p.fill('#x-unit', '미'); await p.fill('#x-cost', '4000'); await p.click('[data-a="extPct"][data-v="10"]');
  assert.strictEqual(await p.inputValue('#x-price'), '4400');
  await p.click('[data-a="extAdd"]');
  // 명세서 두 모드
  await p.click('nav [data-v="statement"]'); await p.click('[data-a="setSMode"][data-v="ledger"]');
  assert.match(await p.textContent('#main'), /거래처원장/);
  await p.reload(); await p.waitForSelector('nav button');
  assert.deepStrictEqual(errs, []);
  await b.close();
});

test('엑셀 가져오기 → 잔액·부가세가 원장과 같음', { skip: !chromium && 'playwright 없음' }, async () => {
  const { b, p, errs } = await open(true);
  await p.click('nav [data-v="settings"]'); await p.click('[data-a="setTab"][data-v="import"]');
  await p.setInputFiles('[data-c="importPick"]', [{ name: 'a.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('x') }, { name: 'b.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('x') }]);
  await p.waitForSelector('[data-a="importApply"]');
  await p.click('[data-a="importApply"]');
  await p.click('[data-m="x"]');
  const db = JSON.parse(await p.evaluate(() => JSON.stringify(DB)));
  assert.strictEqual(db.centers.length, 2);
  assert.strictEqual(db.items.length, 5);
  // 원장 마지막 잔고 31,000 과 같아야 함
  const bal = await p.evaluate(() => unpaid(DB.centers.find(c => c.name.includes('본점')).id));
  assert.strictEqual(bal, 31000);
  // 같은 파일 다시 가져와도 중복 없음
  await p.setInputFiles('[data-c="importPick"]', [{ name: 'a.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('x') }]);
  await p.waitForSelector('[data-a="importApply"]'); await p.click('[data-a="importApply"]'); await p.click('[data-m="x"]');
  assert.strictEqual(await p.evaluate(() => unpaid(DB.centers.find(c => c.name.includes('본점')).id)), 31000);
  // 거래명세표: 2024-01-03, 전잔액 100,000 / 매출 31,000 / 베이컨 공급가 16,364 부가세 1,636
  await p.evaluate(() => { UI.sCenter = DB.centers.find(c => c.name.includes('본점')).id; UI.sMode = 'day'; UI.sDay = '2024-01-03'; go('statement'); });
  const t = await p.textContent('.stmt');
  assert.match(t, /16,364/); assert.match(t, /1,636/); assert.match(t, /100,000/); assert.match(t, /131,000/);
  // 전화 주문: 가져온 품목을 코드로 찾기, 지난 판매가 사용
  await p.evaluate(() => { UI.centerId = DB.centers.find(c => c.name.includes('본점')).id; UI.date = '2024-02-01'; go('orders'); });
  await p.fill('#ph-q', '108242'); await p.dispatchEvent('#ph-q', 'input'); await p.press('#ph-q', 'Enter'); await p.press('#ph-qty', 'Enter');
  assert.match(await p.textContent('.ord-grid > .card'), /2,600원/);
  // AI 사진
  await p.evaluate(() => { DB.settings.ai.key = 'test'; UI.intake = '사진'; UI.photo = 'data:image/jpeg;base64,AAAA'; go('orders'); });
  await p.click('[data-a="aiPhoto"]'); await p.waitForSelector('#rv tbody tr');
  assert.strictEqual(await p.$$eval('#rv tbody tr', r => r.length), 1);
  assert.deepStrictEqual(errs, []);
  await b.close();
});
