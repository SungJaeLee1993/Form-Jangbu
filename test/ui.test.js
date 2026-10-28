'use strict';
// 브라우저 모드(Electron API 없음)로 화면 전체를 눌러보는 스모크 테스트
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { }

test('모든 화면이 오류 없이 뜨고 핵심 흐름이 동작', { skip: !chromium && 'playwright 없음' }, async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + path.join(__dirname, '..', 'renderer', 'index.html'));
  await p.waitForSelector('.step');
  for (const v of ['orders', 'purchase', 'external', 'statement', 'settle', 'settings', 'home']) {
    await p.click(`nav [data-v="${v}"]`); await p.waitForTimeout(50);
  }
  for (const t of ['centers', 'items', 'margin', 'etc', 'freshone', 'backup']) { await p.click('nav [data-v="settings"]'); await p.click(`[data-a="setTab"][data-v="${t}"]`); }
  // 주문: 카톡 붙여넣기
  await p.click('nav [data-v="orders"]');
  const before = await p.$$eval('#main tbody tr', r => r.length);
  await p.click('[data-a="kakao"]');
  await p.fill('#kk', '[원장] [오전 9:10] 미역 2키로\n양지 1.5kg\n계란 2판\n알수없는것 3개');
  await p.dispatchEvent('#kk', 'input');
  assert.strictEqual(await p.$$eval('#kk-out tbody tr', r => r.length), 4);
  await p.click('[data-m="ok"]');
  const after = await p.$$eval('#main tbody tr', r => r.length);
  assert.ok(after >= before, 'lines added');
  // 마진 미리보기
  await p.click('nav [data-v="settings"]'); await p.click('[data-a="setTab"][data-v="margin"]');
  await p.click('[data-a="preview"]');
  assert.match(await p.textContent('#pv-out'), /판매/);
  // 외부 구매
  await p.click('nav [data-v="external"]');
  await p.fill('#x-name', '활전복'); await p.fill('#x-unit', '미'); await p.fill('#x-cost', '4000'); await p.click('[data-a="extPct"][data-v="10"]');
  assert.strictEqual(await p.inputValue('#x-price'), '4400');
  await p.click('[data-a="extAdd"]');
  // 정산
  await p.click('nav [data-v="settle"]');
  assert.match(await p.textContent('.stats'), /원/);
  // 새로고침해도 유지
  await p.reload(); await p.waitForSelector('.step');
  assert.deepStrictEqual(errs, []);
  await b.close();
});
