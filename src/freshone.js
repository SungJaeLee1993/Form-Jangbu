'use strict';
// 온리원푸드넷(CJ프레시웨이) 장바구니 자동 입력 (반자동: 주문 버튼은 사람이 누름)
// 윈도우에 기본으로 깔린 Microsoft Edge를 사용 → 브라우저를 따로 받지 않아 버전 문제 없음.
// 화면 요소(selectors)는 설정 > 프레시원 > 고급에서 JSON으로 넣는다. 실제 화면을 보고 맞춰야 함.
const { chromium } = require('playwright-core');

const DEFAULT_SEL = {
  loginId: 'input[name="id"], input#id, input[type="text"]',
  loginPw: 'input[type="password"]',
  loginBtn: 'button[type="submit"], input[type="submit"]',
  resultFirst: '',
  qtyInput: '',
  addCart: ''
};

let browser = null;

async function run({ account, items }, log = console) {
  let sel = { ...DEFAULT_SEL };
  if (account.selectors && account.selectors.trim()) {
    try { sel = { ...sel, ...JSON.parse(account.selectors) }; }
    catch (e) { return { ok: false, failed: items.map(i => i.name), message: '고급 설정의 JSON 형식이 잘못됐어요.' }; }
  }
  const failed = [];
  try {
    if (!browser || !browser.isConnected()) {
      browser = await chromium.launch({ channel: 'msedge', headless: false });
    }
    const ctx = browser.contexts()[0] || await browser.newContext({ viewport: null });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);

    // 1) 로그인
    await page.goto(account.loginUrl, { waitUntil: 'domcontentloaded' });
    if (await page.locator(sel.loginPw).first().isVisible().catch(() => false)) {
      await page.locator(sel.loginId).first().fill(account.id);
      await page.locator(sel.loginPw).first().fill(account.pw);
      await Promise.all([page.waitForLoadState('domcontentloaded').catch(() => { }), page.locator(sel.loginBtn).first().click()]);
      await page.waitForTimeout(1500);
      // 로그인 창이 그대로면 실패 (온리원푸드넷은 비밀번호를 90일마다 바꿔야 함)
      if (await page.locator(sel.loginPw).first().isVisible().catch(() => false)) {
        return { ok: false, failed: items.map(i => i.name), message: '로그인이 안 됐어요. 비밀번호가 바뀌었거나(90일마다 변경) 변경 안내가 떴는지 열린 창에서 확인해 주세요.' };
      }
    }

    // 2) 품목별 검색 → 수량 → 장바구니
    const ready = account.searchUrl && sel.resultFirst && sel.addCart;
    if (!ready) {
      return { ok: false, failed: items.map(i => i.name), message: '로그인까지만 했어요. 장바구니 자동 담기는 프레시원 화면에 맞춰 설정을 마쳐야 해요.' };
    }
    for (const it of items) {
      try {
        await page.goto(account.searchUrl.replace('{q}', encodeURIComponent(it.code || it.name)), { waitUntil: 'domcontentloaded' });
        const first = page.locator(sel.resultFirst).first();
        await first.waitFor();
        if (sel.qtyInput) await first.locator(sel.qtyInput).first().fill(String(Math.ceil(it.qty)));
        await first.locator(sel.addCart).first().click();
        await page.waitForTimeout(700);
      } catch (e) {
        log.warn('freshone item failed', it.name, e.message);
        failed.push(it.name);
      }
    }
    return { ok: failed.length === 0, failed };
  } catch (e) {
    log.error('freshone run failed', e);
    const noEdge = /msedge|executable/i.test(e.message);
    return { ok: false, failed: items.map(i => i.name), message: noEdge ? 'Microsoft Edge를 찾지 못했어요.' : '프레시원 연결 중 문제가 생겼어요: ' + e.message.split('\n')[0] };
  }
}

async function close() { try { await browser?.close(); } catch (e) { } browser = null; }

module.exports = { run, close };
