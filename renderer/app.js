/* 식자재 장부 — renderer (Electron / 브라우저 공용) */
'use strict';
const API = window.api || null; // Electron preload가 넣어줌
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = n => (Math.round(Number(n) || 0)).toLocaleString('ko-KR') + '원';
const num = n => (Number(n) || 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => ymd(new Date());
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtD = s => { if (!s) return ''; const d = parseD(s); return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WD[d.getDay()] + ')'; };
const month = s => s.slice(0, 7);

/* ---------------- 저장소 ---------------- */
let DB = null;
function sample() {
  const c = ['A조리원', 'B조리원', 'C조리원', 'D조리원'].map(n => ({ id: uid(), name: n, contact: '', memo: '' }));
  const it = [
    ['건미역(기장)', 'kg', 24000, '미역 국'], ['한우 양지', 'kg', 54000, '양지'], ['한우 국거리', 'kg', 42000, '국거리'],
    ['전복(10미)', '팩', 29000, '전복'], ['흰다리새우', 'kg', 21000, '새우'], ['계란 30구', '판', 7800, '계란 달걀'],
    ['국산 두부', '모', 1900, '두부'], ['애호박', '개', 1500, '호박'], ['시금치', '단', 2800, ''], ['우유 1L', '개', 2600, '우유'],
    ['찹쌀', 'kg', 5200, ''], ['대추', 'kg', 16000, '']
  ].map(([name, unit, price, aliases]) => ({ id: uid(), name, unit, price, freshoneName: name, aliases }));
  return {
    version: 1, sample: true,
    settings: { deliveryDays: [1, 3, 5], round: 10, pin: '', biz: { name: '', owner: '', tel: '', no: '' }, freshone: { id: '', pw: '', loginUrl: 'https://www.freshone.co.kr', searchUrl: '', selectors: '' } },
    centers: c, items: it,
    marginRules: [{ id: uid(), scope: 'default', type: 'pct', value: 10, from: '2026-01-01' }],
    orders: [], externals: [], payments: [], purchases: []
  };
}
/* 데이터 구조 버전. 구조를 바꿀 땐 SCHEMA를 올리고 MIGRATIONS에 변환을 추가한다(지우지 말 것). */
const SCHEMA = 1;
const MIGRATIONS = {
  // 2: db => { db.newField = db.newField || []; },
};
function migrate(db) {
  db.version = Number(db.version) || 1;
  if (db.version > SCHEMA) throw new Error('newer-data');
  while (db.version < SCHEMA) { const next = db.version + 1; (MIGRATIONS[next] || (() => { }))(db); db.version = next; }
  // 빠진 칸 채우기 (예전 파일 호환)
  const base = sample();
  for (const k of ['centers', 'items', 'marginRules', 'orders', 'externals', 'payments', 'purchases']) if (!Array.isArray(db[k])) db[k] = [];
  db.settings = Object.assign({}, base.settings, db.settings || {});
  db.settings.biz = Object.assign({}, base.settings.biz, db.settings.biz || {});
  db.settings.freshone = Object.assign({}, base.settings.freshone, db.settings.freshone || {});
  if (!Array.isArray(db.settings.deliveryDays)) db.settings.deliveryDays = base.settings.deliveryDays;
  return db;
}
let READONLY = false;
async function load() {
  let raw = null;
  try { raw = API ? await API.load() : localStorage.getItem('jangbu'); } catch (e) { }
  try { DB = raw ? JSON.parse(raw) : null; } catch (e) { DB = null; }
  if (!DB) { DB = sample(); save(); return; }
  try { const before = DB.version; migrate(DB); if (before !== DB.version) save(); }
  catch (e) { if (e.message === 'newer-data') { READONLY = true; } else throw e; }
}
let saveT = null;
function save() {
  if (READONLY) { toast('더 새 버전에서 만든 데이터라 저장하지 않았어요. 프로그램을 업데이트해 주세요'); return; }
  clearTimeout(saveT);
  saveT = setTimeout(async () => {
    const s = JSON.stringify(DB);
    try { if (API) await API.save(s); else localStorage.setItem('jangbu', s); } catch (e) { toast('저장이 안 됐어요. 다시 시도해 주세요'); }
  }, 300);
}

/* ---------------- 공통 계산 ---------------- */
const center = id => DB.centers.find(c => c.id === id);
const item = id => DB.items.find(i => i.id === id);
const PRI = { itemCenter: 4, item: 3, center: 2, default: 1 };
const SCOPE_L = { default: '기본', center: '조리원별', item: '품목별', itemCenter: '개별 예외' };
function ruleFor(itemId, centerId, date) {
  const ok = DB.marginRules.filter(r => (r.from || '0') <= date && (
    r.scope === 'default' || (r.scope === 'center' && r.centerId === centerId) ||
    (r.scope === 'item' && r.itemId === itemId) || (r.scope === 'itemCenter' && r.itemId === itemId && r.centerId === centerId)));
  ok.sort((a, b) => PRI[b.scope] - PRI[a.scope] || (b.from || '').localeCompare(a.from || ''));
  return ok[0] || null;
}
const ruleLabel = r => !r ? '마진 없음' : SCOPE_L[r.scope] + ' ' + (r.type === 'pct' ? r.value + '%' : r.type === 'won' ? '+' + num(r.value) + '원' : '판매가 ' + num(r.value) + '원');
function roundP(v) { const u = Number(DB.settings.round) || 1; return Math.round(v / u) * u; }
function sellPrice(cost, r) {
  if (!r) return roundP(cost);
  if (r.type === 'pct') return roundP(cost * (1 + Number(r.value) / 100));
  if (r.type === 'won') return roundP(cost + Number(r.value));
  return Number(r.value);
}
function priceLine(itemId, centerId, date) {
  const i = item(itemId), r = ruleFor(itemId, centerId, date), cost = Number(i?.price) || 0;
  return { cost, price: sellPrice(cost, r), rule: ruleLabel(r) };
}
function nextDelivery(from = new Date()) {
  const days = DB.settings.deliveryDays || [];
  if (!days.length) return ymd(from);
  for (let k = 0; k < 8; k++) { const d = new Date(from); d.setDate(d.getDate() + k); if (days.includes(d.getDay())) return ymd(d); }
  return ymd(from);
}
function orderOf(date, centerId) { return DB.orders.find(o => o.date === date && o.centerId === centerId); }
function ordersOn(date) { return DB.orders.filter(o => o.date === date && o.lines.length); }
function purchaseOf(date) { return DB.purchases.find(p => p.date === date); }
function salesLines(centerId, from, to) {
  const L = [];
  DB.orders.filter(o => o.centerId === centerId && o.date >= from && o.date <= to).forEach(o => o.lines.forEach(l => L.push({ date: o.date, name: l.name, unit: l.unit, qty: l.qty, price: l.price, cost: l.cost, ext: false })));
  DB.externals.filter(e => e.centerId === centerId && e.date >= from && e.date <= to).forEach(e => L.push({ date: e.date, name: e.name, unit: e.unit, qty: e.qty, price: e.price, cost: e.cost, ext: true, store: e.store }));
  return L.sort((a, b) => a.date.localeCompare(b.date));
}
const monthRange = m => { const [y, mm] = m.split('-').map(Number); return [m + '-01', ymd(new Date(y, mm, 0))]; };
function unpaid(centerId) {
  const sales = salesLines(centerId, '0000', '9999').reduce((s, l) => s + l.qty * l.price, 0);
  const paid = DB.payments.filter(p => p.centerId === centerId).reduce((s, p) => s + Number(p.amount), 0);
  return sales - paid;
}

/* ---------------- 카톡 주문 인식 ---------------- */
const UNITS = 'kg|키로|킬로|g|그램|개|팩|봉|봉지|박스|box|미|마리|단|판|모|병|통|ea|근|포|망|kg씩';
function parseKakao(text) {
  const names = [];
  DB.items.forEach(i => { [i.name, ...(i.aliases || '').split(/[,\s]+/)].filter(Boolean).forEach(n => names.push({ n: n.replace(/\(.*?\)/g, '').trim(), i })); });
  names.sort((a, b) => b.n.length - a.n.length);
  const out = [];
  text.split(/\n|,|\/|·/).map(s => s.trim()).filter(Boolean).forEach(line => {
    if (/^\[.*\]\s*\[.*\]/.test(line)) line = line.replace(/^\[.*?\]\s*\[.*?\]\s*/, ''); // 카톡 [이름] [시간]
    if (!line || /^-+|님이|사진|이모티콘/.test(line)) return;
    const hit = names.find(x => x.n && line.replace(/\s/g, '').includes(x.n.replace(/\s/g, '')));
    const m = line.match(new RegExp('(\\d+(?:\\.\\d+)?)\\s*(' + UNITS + ')?', 'i'));
    out.push({ raw: line, itemId: hit?.i.id || '', qty: m ? Number(m[1]) : 1, guessQty: !m, ok: !!hit });
  });
  return out;
}

/* ---------------- UI 기초 ---------------- */
let VIEW = 'home';
const UI = { date: null, centerId: null, pdate: null, sCenter: null, sFrom: null, sTo: null, month: null, setTab: 'centers', unlocked: false, itemQ: '' };
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 2200); }
function modal(html, onOk, okLabel = '저장') {
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog">${html}<div class="acts"><button class="btn s" data-m="x">취소</button>${onOk ? `<button class="btn p" data-m="ok">${okLabel}</button>` : ''}</div></div>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.addEventListener('click', e => {
    const b = e.target.closest('[data-m]'); if (e.target === bg) close();
    if (!b) return; if (b.dataset.m === 'x') close(); if (b.dataset.m === 'ok') { if (onOk(bg) !== false) close(); }
  });
  const f = bg.querySelector('input,select,textarea'); if (f) f.focus();
  return bg;
}
const val = (root, sel) => root.querySelector(sel)?.value ?? '';
const NAV = [['home', '', '홈'], ['orders', '1', '주문 받기'], ['purchase', '2', '발주하기'], ['external', '3', '외부 구매'], ['statement', '4', '명세서'], ['settle', '5', '정산'], ['settings', '⚙', '설정']];
function go(v) { VIEW = v; render(); window.scrollTo(0, 0); }
function render() {
  $('#nav').innerHTML = `<div class="brand">식자재 장부</div>` + NAV.map(([k, n, l]) => (k === 'settings' ? '<div class="sp"></div>' : '') +
    `<button class="${VIEW === k ? 'on' : ''}" data-a="go" data-v="${k}">${n ? `<span class="no">${n}</span>` : '<span class="no">⌂</span>'}${l}</button>`).join('');
  $('#main').innerHTML = (V[VIEW] || V.home)();
  (AFTER[VIEW] || (() => { }))();
}

/* ---------------- 화면 ---------------- */
const V = {}, AFTER = {};
AFTER.settings = async () => { const el = $('#appinfo'); if (el && API?.info) { const i = await API.info(); el.innerHTML = `버전 <b>${esc(i.version)}</b> · 데이터 위치 ${esc(i.dataDir)}<br>최근 백업 ${esc(i.backups[0] || '없음')}`; } };

V.home = () => {
  const nd = nextDelivery(), os = ordersOn(nd), p = purchaseOf(nd);
  const got = os.length, total = DB.centers.length;
  const ext = DB.externals.filter(e => month(e.date) === month(today())).length;
  const due = DB.centers.reduce((s, c) => s + Math.max(0, unpaid(c.id)), 0);
  const step = got < total ? 'orders' : (!p || p.status !== 'done') ? 'purchase' : 'statement';
  const S = (k, no, t, c) => `<button class="step ${step === k ? 'next' : ''}" data-a="go" data-v="${k}"><span class="k">${no}${step === k ? ' · 지금 할 차례' : ''}</span><span><div class="t">${t}</div><div class="c">${c}</div></span></button>`;
  return `${DB.sample ? `<div class="warn noprint">지금은 <b>예시 데이터</b>예요. 설정 › 백업에서 지우고 시작할 수 있어요.</div>` : ''}
  <div class="small">다음 배송일</div><h1 style="font-size:32px;line-height:42px">${fmtD(nd)}</h1>
  <div class="home-steps">
   ${S('orders', '1단계', '주문 받기', `${got} / ${total}곳 받음`)}
   ${S('purchase', '2단계', '발주하기', p?.status === 'done' ? '발주 완료' : p?.status === 'cart' ? '장바구니 담음' : '아직 안 함')}
   ${S('external', '3단계', '외부 구매', `이번 달 ${ext}건`)}
   ${S('statement', '4단계', '명세서', '조리원별 출력')}
   ${S('settle', '5단계', '정산', due > 0 ? `받을 돈 ${won(due)}` : '받을 돈 없음')}
  </div>
  <div class="card"><h2>${fmtD(nd)} 주문 현황</h2>
  <table><thead><tr><th>조리원</th><th class="n">품목 수</th><th class="n">금액</th><th>상태</th></tr></thead><tbody>
  ${DB.centers.map(c => { const o = orderOf(nd, c.id), n = o?.lines.length || 0, amt = (o?.lines || []).reduce((s, l) => s + l.qty * l.price, 0);
    return `<tr><td><b>${esc(c.name)}</b></td><td class="n">${n}</td><td class="n">${won(amt)}</td><td>${n ? '<span class="badge b-ok">받음</span>' : '<span class="badge b-n">대기</span>'}</td></tr>`; }).join('')}
  </tbody></table></div>`;
};

/* 1. 주문 받기 */
V.orders = () => {
  UI.date = UI.date || nextDelivery(); UI.centerId = UI.centerId && center(UI.centerId) ? UI.centerId : DB.centers[0]?.id;
  if (!DB.centers.length) return `<h1>주문 받기</h1><div class="empty">설정에서 조리원을 먼저 추가해 주세요<br><br><button class="btn p" data-a="go" data-v="settings">설정으로</button></div>`;
  const o = orderOf(UI.date, UI.centerId), lines = o?.lines || [];
  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const freq = {}; DB.orders.filter(x => x.centerId === UI.centerId).forEach(x => x.lines.forEach(l => freq[l.itemId] = (freq[l.itemId] || 0) + 1));
  const fav = DB.items.slice().sort((a, b) => (freq[b.id] || 0) - (freq[a.id] || 0)).slice(0, 14);
  return `<h1>주문 받기</h1><div class="sub">조리원을 고르고 품목을 눌러 담아요. 바로 저장돼요.</div>
  <div class="row" style="margin-bottom:16px"><div class="field"><label>배송일</label><input type="date" value="${UI.date}" data-c="setDate"></div><div class="grow"></div></div>
  <div class="tabs" style="margin-bottom:16px">${DB.centers.map(c => `<button class="${c.id === UI.centerId ? 'on' : ''}" data-a="setCenter" data-v="${c.id}">${esc(c.name)}${orderOf(UI.date, c.id)?.lines.length ? ' ✓' : ''}</button>`).join('')}</div>
  <div class="card"><div class="row" style="margin-bottom:16px"><h2 class="grow" style="margin:0">${esc(center(UI.centerId).name)} · ${fmtD(UI.date)}</h2>
   <button class="btn s" data-a="copyLast">지난번이랑 똑같이</button><button class="btn s" data-a="kakao">카톡 붙여넣기</button></div>
   ${lines.length ? `<table><thead><tr><th>품목</th><th class="n">수량</th><th>단위</th><th class="n">단가</th><th class="n">금액</th><th>적용 마진</th><th></th></tr></thead><tbody>
   ${lines.map((l, k) => `<tr><td><b>${esc(l.name)}</b></td><td class="n"><input class="num" type="number" inputmode="decimal" min="0" step="0.5" value="${l.qty}" data-c="setQty" data-k="${k}"></td><td>${esc(l.unit)}</td><td class="n">${won(l.price)}</td><td class="n"><b>${won(l.qty * l.price)}</b></td><td class="small">${esc(l.rule)}</td><td><button class="btn t" data-a="delLine" data-k="${k}">빼기</button></td></tr>`).join('')}
   </tbody><tfoot><tr><td colspan="4">합계</td><td class="n">${won(total)}</td><td colspan="2"></td></tr></tfoot></table>`
    : `<div class="empty">아직 담은 품목이 없어요</div>`}
  </div>
  <div class="card"><h2>품목 담기</h2><div class="small" style="margin-bottom:12px">자주 시키는 순서예요. 누르면 1개씩 담겨요.</div>
   <div class="chips">${fav.map(i => `<button class="chip" data-a="addItem" data-v="${i.id}">${esc(i.name)}</button>`).join('')}</div>
   <div class="row" style="margin-top:16px"><select id="pick" class="grow"><option value="">다른 품목 고르기…</option>${DB.items.map(i => `<option value="${i.id}">${esc(i.name)} (${esc(i.unit)})</option>`).join('')}</select><button class="btn s" data-a="addPicked">담기</button></div></div>`;
};
function ensureOrder() {
  let o = orderOf(UI.date, UI.centerId);
  if (!o) { o = { id: uid(), date: UI.date, centerId: UI.centerId, lines: [] }; DB.orders.push(o); }
  return o;
}
function addLine(o, itemId, qty = 1) {
  const i = item(itemId); if (!i) return;
  const ex = o.lines.find(l => l.itemId === itemId);
  if (ex) { ex.qty = +(ex.qty + qty).toFixed(2); return; }
  o.lines.push({ itemId, name: i.name, unit: i.unit, qty, ...priceLine(itemId, o.centerId, o.date) });
}

/* 2. 발주하기 */
function aggregate(date) {
  const m = {};
  ordersOn(date).forEach(o => o.lines.forEach(l => {
    const k = l.itemId; const i = item(k);
    m[k] = m[k] || { itemId: k, name: l.name, unit: l.unit, freshoneName: i?.freshoneName || '', cost: i ? Number(i.price) : l.cost, qty: 0, by: [] };
    m[k].qty = +(m[k].qty + Number(l.qty)).toFixed(2); m[k].by.push((center(o.centerId)?.name || '').replace('조리원', '') + ' ' + num(l.qty));
  }));
  return Object.values(m).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
V.purchase = () => {
  UI.pdate = UI.pdate || nextDelivery();
  const rows = aggregate(UI.pdate), p = purchaseOf(UI.pdate), total = rows.reduce((s, r) => s + r.qty * r.cost, 0);
  const missing = rows.filter(r => !r.freshoneName).length;
  const st = p?.status === 'done' ? '<span class="badge b-ok">발주 완료</span>' : p?.status === 'cart' ? '<span class="badge b-info">장바구니 담음</span>' : '<span class="badge b-n">아직 안 함</span>';
  return `<h1>발주하기</h1><div class="sub">조리원 주문을 품목별로 합쳤어요. 프레시원 장바구니에 넣고, 주문 버튼은 직접 눌러 주세요.</div>
  <div class="row" style="margin-bottom:16px"><div class="field"><label>배송일</label><input type="date" value="${UI.pdate}" data-c="setPDate"></div><div class="grow"></div>${st}</div>
  ${missing ? `<div class="warn">프레시원 상품명이 없는 품목이 ${missing}개 있어요. 설정 › 품목에서 넣어 주세요.</div>` : ''}
  <div class="card">${rows.length ? `<table><thead><tr><th>품목</th><th>프레시원 상품명</th><th class="n">합계 수량</th><th>조리원별</th><th class="n">매입 단가</th><th class="n">매입 금액</th></tr></thead><tbody>
   ${rows.map(r => `<tr><td><b>${esc(r.name)}</b></td><td>${r.freshoneName ? esc(r.freshoneName) : '<span class="badge b-warn">없음</span>'}</td><td class="n"><b>${num(r.qty)}</b> ${esc(r.unit)}</td><td class="small">${esc(r.by.join(' · '))}</td><td class="n">${won(r.cost)}</td><td class="n">${won(r.qty * r.cost)}</td></tr>`).join('')}
   </tbody><tfoot><tr><td colspan="5">예상 매입 합계</td><td class="n">${won(total)}</td></tr></tfoot></table>` : `<div class="empty">${fmtD(UI.pdate)} 주문이 아직 없어요</div>`}</div>
  ${rows.length ? `<div class="row"><button class="btn p" data-a="freshone">프레시원에 넣기</button><button class="btn s" data-a="copyList">목록 복사</button><div class="grow"></div><button class="btn s" data-a="markDone">${p?.status === 'done' ? '발주 완료 취소' : '주문 끝냈어요'}</button></div>
  <div class="small" style="margin-top:12px">‘주문 끝냈어요’를 누르면 지금 매입가로 이번 주문의 단가를 다시 계산해요.</div>` : ''}`;
};

/* 3. 외부 구매 */
V.external = () => {
  const m = month(today()), list = DB.externals.filter(e => month(e.date) >= monthRange(m)[0].slice(0, 7)).sort((a, b) => b.date.localeCompare(a.date));
  return `<h1>외부 구매</h1><div class="sub">프레시원에 없어서 따로 산 물건이에요. 마진은 직접 넣고, 해당 조리원 장부와 명세서에 올라가요.</div>
  <div class="card"><h2>새로 적기</h2>
   <div class="grid2">
    <div class="field"><label>날짜</label><input type="date" id="x-date" value="${nextDelivery()}"></div>
    <div class="field"><label>조리원</label><select id="x-center">${DB.centers.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
    <div class="field"><label>품목</label><input id="x-name" list="itemlist" placeholder="예: 전복"><datalist id="itemlist">${DB.items.map(i => `<option value="${esc(i.name)}">`).join('')}</datalist></div>
    <div class="field"><label>구입처</label><input id="x-store" placeholder="예: 시장, 코스트코"></div>
    <div class="field"><label>수량</label><input id="x-qty" type="number" inputmode="decimal" value="1" data-i="extCalc"></div>
    <div class="field"><label>단위</label><input id="x-unit" placeholder="kg, 개, 팩"></div>
    <div class="field"><label>산 값 (1단위)</label><input id="x-cost" type="number" inputmode="numeric" placeholder="원" data-i="extCalc"></div>
    <div class="field"><label>받을 값 (1단위)</label><input id="x-price" type="number" inputmode="numeric" placeholder="원" data-i="extCalc2"></div>
   </div>
   <div class="row" style="margin-top:12px"><span class="small">빠른 마진</span>${[0, 5, 10, 15, 20, 30].map(p => `<button class="chip" data-a="extPct" data-v="${p}">${p}%</button>`).join('')}<span class="grow"></span><span id="x-sum" class="small"></span></div>
   <div class="row" style="margin-top:16px"><div class="grow"></div><button class="btn p" data-a="extAdd">장부에 올리기</button></div></div>
  <div class="card"><h2>최근 외부 구매</h2>${list.length ? `<table><thead><tr><th>날짜</th><th>조리원</th><th>품목</th><th>구입처</th><th class="n">수량</th><th class="n">산 값</th><th class="n">받을 값</th><th class="n">이익</th><th></th></tr></thead><tbody>
  ${list.map(e => `<tr><td>${fmtD(e.date)}</td><td>${esc(center(e.centerId)?.name)}</td><td><b>${esc(e.name)}</b> <span class="badge b-warn">외부 구매</span></td><td>${esc(e.store)}</td><td class="n">${num(e.qty)} ${esc(e.unit)}</td><td class="n">${won(e.cost)}</td><td class="n">${won(e.price)}</td><td class="n">${won((e.price - e.cost) * e.qty)}</td><td><button class="btn t" data-a="extDel" data-v="${e.id}">삭제</button></td></tr>`).join('')}
  </tbody></table>` : '<div class="empty">아직 없어요</div>'}</div>`;
};

/* 4. 명세서 */
V.statement = () => {
  UI.sCenter = UI.sCenter && center(UI.sCenter) ? UI.sCenter : DB.centers[0]?.id;
  if (!UI.sFrom) [UI.sFrom, UI.sTo] = monthRange(month(today()));
  if (!UI.sCenter) return `<h1>명세서</h1><div class="empty">조리원이 없어요</div>`;
  const L = salesLines(UI.sCenter, UI.sFrom, UI.sTo), sum = L.reduce((s, l) => s + l.qty * l.price, 0), b = DB.settings.biz;
  return `<div class="noprint"><h1>명세서</h1><div class="sub">조리원과 기간을 고르면 자동으로 만들어져요.</div>
  <div class="row" style="margin-bottom:16px"><div class="field"><label>조리원</label><select data-c="setSCenter">${DB.centers.map(c => `<option value="${c.id}" ${c.id === UI.sCenter ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
   <div class="field"><label>시작</label><input type="date" value="${UI.sFrom}" data-c="setSFrom"></div><div class="field"><label>끝</label><input type="date" value="${UI.sTo}" data-c="setSTo"></div>
   <div class="grow"></div><button class="btn s" data-a="copyStatement">글로 복사</button><button class="btn p" data-a="printIt">인쇄 · PDF</button></div></div>
  <div class="sheet"><h1>거래명세서</h1>
   <div class="meta"><div><div class="small">받는 곳</div><b style="font-size:20px">${esc(center(UI.sCenter).name)}</b> 귀하<div class="small">${fmtD(UI.sFrom)} ~ ${fmtD(UI.sTo)}</div></div>
   <div style="text-align:right"><div class="small">공급자</div><b>${esc(b.name || '(상호 미입력)')}</b><div class="small">${esc([b.owner, b.no, b.tel].filter(Boolean).join(' · ') || '설정 › 배송·기타에서 입력')}</div></div></div>
   <table><thead><tr><th>날짜</th><th>품목</th><th class="n">수량</th><th>단위</th><th class="n">단가</th><th class="n">금액</th><th>비고</th></tr></thead><tbody>
   ${L.length ? L.map(l => `<tr><td>${l.date.slice(5).replace('-', '/')}</td><td>${esc(l.name)}</td><td class="n">${num(l.qty)}</td><td>${esc(l.unit)}</td><td class="n">${num(l.price)}</td><td class="n">${num(l.qty * l.price)}</td><td>${l.ext ? '별도 구매' : ''}</td></tr>`).join('') : '<tr><td colspan="7" class="empty">이 기간 거래가 없어요</td></tr>'}
   </tbody><tfoot><tr><td colspan="5">합계</td><td class="n">${won(sum)}</td><td></td></tr></tfoot></table></div>`;
};

/* 5. 정산 */
V.settle = () => {
  UI.month = UI.month || month(today());
  const [f, t] = monthRange(UI.month);
  const rows = DB.centers.map(c => {
    const L = salesLines(c.id, f, t), sales = L.reduce((s, l) => s + l.qty * l.price, 0), cost = L.reduce((s, l) => s + l.qty * l.cost, 0);
    const paid = DB.payments.filter(p => p.centerId === c.id && p.month === UI.month).reduce((s, p) => s + Number(p.amount), 0);
    return { c, sales, cost, profit: sales - cost, paid, due: sales - paid, all: unpaid(c.id) };
  });
  const T = k => rows.reduce((s, r) => s + r[k], 0);
  const allDue = rows.reduce((s, r) => s + Math.max(0, r.all), 0);
  const pays = DB.payments.filter(p => p.month === UI.month).sort((a, b) => b.date.localeCompare(a.date));
  return `<h1>정산</h1><div class="sub">달별 매출·이익과 받을 돈이에요.</div>
  <div class="row" style="margin-bottom:16px"><div class="field"><label>월</label><input type="month" value="${UI.month}" data-c="setMonth"></div><div class="grow"></div><button class="btn p" data-a="payAdd">입금 기록</button></div>
  <div class="stats"><div class="stat"><div class="l">매출</div><div class="v">${won(T('sales'))}</div></div><div class="stat"><div class="l">이익</div><div class="v">${won(T('profit'))}</div><div class="small">마진율 ${T('sales') ? (T('profit') / T('sales') * 100).toFixed(1) : 0}%</div></div>
   <div class="stat"><div class="l">이번 달 받을 돈</div><div class="v ${T('due') > 0 ? 'red' : ''}">${won(T('due'))}</div></div><div class="stat"><div class="l">전체 미수금 (누적)</div><div class="v ${allDue > 0 ? 'red' : ''}">${won(allDue)}</div></div></div>
  <div class="card"><table><thead><tr><th>조리원</th><th class="n">매출</th><th class="n">매입</th><th class="n">이익</th><th class="n">마진율</th><th class="n">입금</th><th class="n">이번 달 남은 돈</th><th>상태</th></tr></thead><tbody>
  ${rows.map(r => `<tr><td><b>${esc(r.c.name)}</b></td><td class="n">${won(r.sales)}</td><td class="n">${won(r.cost)}</td><td class="n">${won(r.profit)}</td><td class="n">${r.sales ? (r.profit / r.sales * 100).toFixed(1) + '%' : '-'}</td><td class="n">${won(r.paid)}</td><td class="n ${r.due > 0 ? 'red' : ''}">${won(r.due)}</td><td>${!r.sales ? '<span class="badge b-n">거래 없음</span>' : r.due <= 0 ? '<span class="badge b-ok">입금 완료</span>' : '<span class="badge b-bad">미수금</span>'}</td></tr>`).join('')}
  </tbody></table></div>
  <div class="card"><h2>${UI.month.replace('-', '년 ')}월 입금 기록</h2>${pays.length ? `<table><thead><tr><th>입금일</th><th>조리원</th><th class="n">금액</th><th>메모</th><th></th></tr></thead><tbody>${pays.map(p => `<tr><td>${fmtD(p.date)}</td><td>${esc(center(p.centerId)?.name)}</td><td class="n">${won(p.amount)}</td><td>${esc(p.memo)}</td><td><button class="btn t" data-a="payDel" data-v="${p.id}">삭제</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">아직 없어요</div>'}</div>`;
};

/* ⚙ 설정 */
const SETTABS = [['centers', '조리원'], ['items', '품목'], ['margin', '마진'], ['etc', '배송·기타'], ['freshone', '프레시원'], ['backup', '백업']];
V.settings = () => {
  if (DB.settings.pin && !UI.unlocked) return `<h1>설정</h1><div class="card" style="max-width:420px"><div class="field"><label>비밀번호</label><input type="password" id="pin" inputmode="numeric"></div><div class="row" style="margin-top:16px"><button class="btn p" data-a="unlock">열기</button></div></div>`;
  return `<h1>설정</h1><div class="sub">평소엔 건드릴 일 없어요. 품목·가격·마진이 바뀔 때만 와요.</div>
  <div class="tabs" style="margin-bottom:16px">${SETTABS.map(([k, l]) => `<button class="${UI.setTab === k ? 'on' : ''}" data-a="setTab" data-v="${k}">${l}</button>`).join('')}</div>${SV[UI.setTab]()}`;
};
const SV = {};
SV.centers = () => `<div class="card"><div class="row" style="margin-bottom:16px"><h2 class="grow" style="margin:0">조리원 ${DB.centers.length}곳</h2><button class="btn p" data-a="centerEdit">조리원 추가</button></div>
 <table><thead><tr><th>이름</th><th>담당자·연락처</th><th>메모</th><th class="n">받을 돈</th><th></th></tr></thead><tbody>${DB.centers.map(c => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.contact)}</td><td>${esc(c.memo)}</td><td class="n">${won(unpaid(c.id))}</td><td><button class="btn t" data-a="centerEdit" data-v="${c.id}">수정</button></td></tr>`).join('')}</tbody></table></div>`;
SV.items = () => {
  const q = UI.itemQ.trim(), list = DB.items.filter(i => !q || (i.name + i.aliases + i.freshoneName).includes(q));
  return `<div class="card"><div class="row" style="margin-bottom:16px"><h2 style="margin:0">품목 ${DB.items.length}개</h2><input class="grow" placeholder="품목 찾기" value="${esc(UI.itemQ)}" data-i="itemQ" id="itemQ"><button class="btn p" data-a="itemEdit">품목 추가</button></div>
  <div class="small" style="margin-bottom:12px">매입가는 프레시원 가격이에요. 바뀌면 여기서 고치면 새 주문부터 적용돼요.</div>
  <table><thead><tr><th>품목</th><th>단위</th><th class="n">매입가</th><th>프레시원 상품명</th><th>카톡 인식용 다른 이름</th><th></th></tr></thead><tbody>${list.map(i => `<tr><td><b>${esc(i.name)}</b></td><td>${esc(i.unit)}</td><td class="n">${won(i.price)}</td><td>${i.freshoneName ? esc(i.freshoneName) : '<span class="badge b-warn">없음</span>'}</td><td class="small">${esc(i.aliases)}</td><td><button class="btn t" data-a="itemEdit" data-v="${i.id}">수정</button></td></tr>`).join('')}</tbody></table></div>`;
};
SV.margin = () => {
  const rs = DB.marginRules.slice().sort((a, b) => PRI[b.scope] - PRI[a.scope] || (b.from || '').localeCompare(a.from || ''));
  return `<div class="note">우선순위: <b>개별 예외(품목×조리원)</b> → <b>품목별</b> → <b>조리원별</b> → <b>기본</b>. 같은 단계면 적용일이 최근인 게 이겨요. 적용일 전 주문은 예전 마진 그대로예요.</div>
  <div class="card"><div class="row" style="margin-bottom:16px"><h2 class="grow" style="margin:0">마진 규칙</h2><button class="btn p" data-a="ruleEdit">규칙 추가</button></div>
  <table><thead><tr><th>단계</th><th>대상</th><th>방식</th><th>적용일</th><th></th></tr></thead><tbody>${rs.map(r => `<tr><td><span class="badge ${r.scope === 'default' ? 'b-n' : 'b-info'}">${SCOPE_L[r.scope]}</span></td><td><b>${esc([r.itemId && item(r.itemId)?.name, r.centerId && center(r.centerId)?.name].filter(Boolean).join(' × ') || '전체')}</b></td><td>${r.type === 'pct' ? r.value + '% 붙이기' : r.type === 'won' ? num(r.value) + '원 붙이기' : '판매가 ' + won(r.value)}</td><td>${fmtD(r.from)}</td><td><button class="btn t" data-a="ruleEdit" data-v="${r.id}">수정</button></td></tr>`).join('')}</tbody></table></div>
  <div class="card"><h2>미리 계산해 보기</h2><div class="row"><select id="pv-i">${DB.items.map(i => `<option value="${i.id}">${esc(i.name)}</option>`).join('')}</select><select id="pv-c">${DB.centers.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><button class="btn s" data-a="preview">계산</button><b id="pv-out" class="blue"></b></div></div>`;
};
SV.etc = () => {
  const s = DB.settings, b = s.biz;
  return `<div class="card"><h2>배송 요일</h2><div class="small" style="margin-bottom:12px">홈 화면의 ‘다음 배송일’이 이걸로 정해져요.</div>
  <div class="chips">${WD.map((w, d) => `<button class="chip" style="${s.deliveryDays.includes(d) ? 'background:var(--blue-500);color:#fff;border-color:var(--blue-500)' : ''}" data-a="toggleDay" data-v="${d}">${w}</button>`).join('')}</div></div>
  <div class="card"><h2>판매가 끝자리</h2><select data-c="setRound">${[1, 10, 100, 1000].map(u => `<option value="${u}" ${Number(s.round) === u ? 'selected' : ''}>${u}원 단위로 반올림</option>`).join('')}</select></div>
  <div class="card"><h2>명세서에 들어갈 내 정보</h2><div class="grid2">
   <div class="field"><label>상호</label><input data-c="biz" data-k="name" value="${esc(b.name)}"></div><div class="field"><label>대표자</label><input data-c="biz" data-k="owner" value="${esc(b.owner)}"></div>
   <div class="field"><label>사업자번호</label><input data-c="biz" data-k="no" value="${esc(b.no)}"></div><div class="field"><label>연락처</label><input data-c="biz" data-k="tel" value="${esc(b.tel)}"></div></div></div>
  <div class="card"><h2>설정 잠금 비밀번호</h2><div class="small" style="margin-bottom:12px">비워두면 잠그지 않아요.</div><input type="password" inputmode="numeric" data-c="setPin" value="${esc(s.pin)}" placeholder="숫자 4자리"></div>`;
};
SV.freshone = () => {
  const f = DB.settings.freshone;
  return `<div class="warn">프레시원 화면에 맞춰 마지막 연결 작업이 남아 있어요. 로그인·발주 화면 캡처를 받으면 아래 고급 설정을 채워서 완성해요.</div>
  <div class="card"><h2>계정</h2><div class="small" style="margin-bottom:12px">이 컴퓨터에만 저장돼요.</div><div class="grid2">
   <div class="field"><label>아이디</label><input data-c="fo" data-k="id" value="${esc(f.id)}"></div><div class="field"><label>비밀번호</label><input type="password" data-c="fo" data-k="pw" value="${esc(f.pw)}"></div>
   <div class="field"><label>로그인 주소</label><input data-c="fo" data-k="loginUrl" value="${esc(f.loginUrl)}"></div><div class="field"><label>상품 검색 주소 ({q} 자리에 상품명)</label><input data-c="fo" data-k="searchUrl" value="${esc(f.searchUrl)}" placeholder="https://…/search?keyword={q}"></div></div></div>
  <div class="card"><h2>고급: 화면 요소 (아들 전용)</h2><div class="small" style="margin-bottom:12px">JSON. 예: {"loginId":"#id","loginPw":"#pw","loginBtn":"button[type=submit]","resultFirst":".prd-item:first-child","qtyInput":"input.qty","addCart":"button.cart"}</div>
  <textarea data-c="fo" data-k="selectors" style="font-family:monospace;font-size:15px">${esc(f.selectors)}</textarea></div>`;
};
SV.backup = () => `<div class="card"><h2>프로그램 정보</h2><div id="appinfo" class="small">브라우저 미리보기</div></div>
 <div class="card"><h2>백업</h2><div class="small" style="margin-bottom:16px">매일 자동으로 백업돼요(30일치). 따로 보관하고 싶으면 백업 파일을 저장해 두세요.</div>
 <div class="row"><button class="btn p" data-a="backupSave">백업 파일 저장</button>${API ? '<button class="btn s" data-a="openBackups">자동 백업 폴더 열기</button>' : ''}<label class="btn s" style="display:inline-flex;align-items:center">백업 불러오기<input type="file" accept=".json" data-c="backupLoad" hidden></label></div></div>
 <div class="card"><h2>처음부터 시작</h2><div class="small" style="margin-bottom:16px">조리원·품목만 남기고 주문·외부 구매·입금 기록을 지우거나, 전부 지울 수 있어요.</div>
 <div class="row"><button class="btn s" data-a="clearRecords">기록만 지우기</button><button class="btn d" data-a="clearAll">전부 지우기</button><button class="btn s" data-a="loadSample">예시 데이터 다시 넣기</button></div></div>`;

/* ---------------- 동작 ---------------- */
const A = {
  go: d => go(d.v),
  setDate: (d, el) => { UI.date = el.value; render(); },
  setCenter: d => { UI.centerId = d.v; render(); },
  addItem: d => { addLine(ensureOrder(), d.v); save(); render(); },
  addPicked: () => { const v = $('#pick').value; if (!v) return toast('품목을 골라주세요'); addLine(ensureOrder(), v); save(); render(); },
  setQty: (d, el) => { const o = orderOf(UI.date, UI.centerId); const q = Number(el.value); if (!(q >= 0)) return; o.lines[d.k].qty = q; if (q === 0) o.lines.splice(d.k, 1); save(); render(); },
  delLine: d => { const o = orderOf(UI.date, UI.centerId); o.lines.splice(d.k, 1); save(); render(); toast('뺐어요'); },
  copyLast: () => {
    const prev = DB.orders.filter(o => o.centerId === UI.centerId && o.date < UI.date && o.lines.length).sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!prev) return toast('지난 주문이 없어요');
    const o = ensureOrder(); prev.lines.forEach(l => addLine(o, l.itemId, l.qty)); save(); render(); toast(fmtD(prev.date) + ' 주문을 그대로 담았어요');
  },
  kakao: () => {
    const bg = modal(`<h2>카톡 주문 붙여넣기</h2><div class="small" style="margin-bottom:12px">카톡 메시지를 길게 눌러 복사한 다음 아래에 붙여넣어 주세요.</div><textarea id="kk" placeholder="미역 2키로&#10;양지 1.5kg&#10;계란 2판"></textarea><div id="kk-out" style="margin-top:16px"></div>`, b => {
      const rows = b._rows || parseKakao(val(b, '#kk')); const o = ensureOrder(); let n = 0;
      rows.forEach((r, k) => { const sel = b.querySelector(`[data-kk="${k}"]`)?.value || r.itemId; const q = Number(b.querySelector(`[data-kq="${k}"]`)?.value ?? r.qty); if (sel && q > 0) { addLine(o, sel, q); n++; } });
      if (!n) { toast('담을 품목이 없어요'); return false; } save(); render(); toast(n + '개 품목을 담았어요');
    }, '담기');
    const ta = bg.querySelector('#kk');
    ta.addEventListener('input', () => {
      const rows = bg._rows = parseKakao(ta.value);
      bg.querySelector('#kk-out').innerHTML = rows.length ? `<table><thead><tr><th>메시지</th><th>품목</th><th class="n">수량</th></tr></thead><tbody>${rows.map((r, k) => `<tr><td class="small">${esc(r.raw)}</td><td><select data-kk="${k}" style="min-height:40px;font-size:16px;padding:6px 8px"><option value="">${r.ok ? '' : '⚠ 못 찾음 — 고르기'}</option>${DB.items.map(i => `<option value="${i.id}" ${i.id === r.itemId ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select></td><td class="n"><input class="num" style="width:80px;min-height:40px" type="number" value="${r.qty}" data-kq="${k}"></td></tr>`).join('')}</tbody></table>` : '';
    });
  },
  setPDate: (d, el) => { UI.pdate = el.value; render(); },
  copyList: async () => {
    const t = aggregate(UI.pdate).map(r => `${r.freshoneName || r.name}\t${num(r.qty)}${r.unit}`).join('\n');
    try { await navigator.clipboard.writeText(t); toast('복사했어요. 프레시원에 붙여넣으세요'); } catch (e) { modal(`<h2>목록</h2><textarea readonly>${esc(t)}</textarea>`); }
  },
  freshone: async () => {
    const rows = aggregate(UI.pdate); if (!rows.length) return;
    if (!API?.freshone) return modal(`<h2>PC 프로그램에서만 돼요</h2><p>프레시원 자동 입력은 윈도우에 설치한 프로그램에서 동작해요. 지금은 ‘목록 복사’를 써 주세요.</p>`);
    const f = DB.settings.freshone; if (!f.id || !f.pw) { toast('설정 › 프레시원에서 아이디·비밀번호를 넣어 주세요'); return go('settings'); }
    toast('프레시원을 여는 중이에요…');
    const res = await API.freshone({ account: f, items: rows.map(r => ({ name: r.freshoneName || r.name, qty: r.qty, unit: r.unit })) });
    let p = purchaseOf(UI.pdate); if (!p) { p = { id: uid(), date: UI.pdate, status: 'cart' }; DB.purchases.push(p); } else if (p.status !== 'done') p.status = 'cart';
    save(); render();
    modal(`<h2>${res.ok ? '장바구니에 담았어요' : '일부만 담았어요'}</h2><p>열린 프레시원 창에서 장바구니를 확인하고 <b>주문 버튼은 직접</b> 눌러 주세요.</p>${(res.failed || []).length ? `<div class="warn">못 담은 품목: ${esc(res.failed.join(', '))}<br>직접 담아 주세요.</div>` : ''}${res.message ? `<div class="small">${esc(res.message)}</div>` : ''}`);
  },
  markDone: () => {
    let p = purchaseOf(UI.pdate);
    if (p?.status === 'done') { p.status = 'cart'; save(); render(); return toast('발주 완료를 취소했어요'); }
    if (!p) { p = { id: uid(), date: UI.pdate }; DB.purchases.push(p); }
    p.status = 'done'; p.doneAt = new Date().toISOString();
    ordersOn(UI.pdate).forEach(o => o.lines.forEach(l => Object.assign(l, priceLine(l.itemId, o.centerId, o.date))));
    save(); render(); toast('발주 완료! 단가를 지금 매입가로 맞췄어요');
  },
  extCalc: () => { const c = Number($('#x-cost').value), q = Number($('#x-qty').value) || 0, p = Number($('#x-price').value); $('#x-sum').textContent = c && p ? `이익 ${won((p - c) * q)} (${((p - c) / c * 100).toFixed(1)}%)` : ''; },
  extCalc2: () => A.extCalc(),
  extPct: d => { const c = Number($('#x-cost').value); if (!c) return toast('산 값을 먼저 넣어 주세요'); $('#x-price').value = roundP(c * (1 + Number(d.v) / 100)); A.extCalc(); },
  extAdd: () => {
    const e = { id: uid(), date: $('#x-date').value, centerId: $('#x-center').value, name: $('#x-name').value.trim(), store: $('#x-store').value.trim(), qty: Number($('#x-qty').value), unit: $('#x-unit').value.trim(), cost: Number($('#x-cost').value), price: Number($('#x-price').value) };
    if (!e.name) return toast('품목을 적어 주세요'); if (!(e.qty > 0)) return toast('수량을 넣어 주세요'); if (!(e.cost >= 0) || !(e.price > 0)) return toast('산 값과 받을 값을 넣어 주세요');
    if (e.price < e.cost && !confirmSoft()) return;
    DB.externals.push(e); save(); render(); toast(center(e.centerId).name + ' 장부에 올렸어요');
  },
  extDel: d => modal('<h2>이 외부 구매를 지울까요?</h2>', () => { DB.externals = DB.externals.filter(e => e.id !== d.v); save(); render(); }, '지우기'),
  setSCenter: (d, el) => { UI.sCenter = el.value; render(); },
  setSFrom: (d, el) => { UI.sFrom = el.value; render(); },
  setSTo: (d, el) => { UI.sTo = el.value; render(); },
  printIt: async () => {
    if (!API?.printPDF) { try { window.print(); } catch (e) { } return toast('인쇄는 PC 프로그램에서 돼요'); }
    modal('<h2>어떻게 뽑을까요?</h2><div class="row"><button class="btn p grow" data-a="printPaper">종이로 인쇄</button><button class="btn s grow" data-a="printPdf">PDF로 저장</button></div>');
  },
  printPaper: async () => { document.querySelector('.modal-bg')?.remove(); try { await API.printPaper(); } catch (e) { toast('인쇄가 안 됐어요'); } },
  printPdf: async () => { document.querySelector('.modal-bg')?.remove(); try { if (await API.printPDF(center(UI.sCenter).name + '_' + UI.sFrom + '_' + UI.sTo)) toast('PDF로 저장했어요'); } catch (e) { toast('PDF 저장이 안 됐어요'); } },
  copyStatement: async () => {
    const L = salesLines(UI.sCenter, UI.sFrom, UI.sTo), sum = L.reduce((s, l) => s + l.qty * l.price, 0);
    const t = `[거래명세서] ${center(UI.sCenter).name}\n${fmtD(UI.sFrom)} ~ ${fmtD(UI.sTo)}\n\n` + L.map(l => `${l.date.slice(5).replace('-', '/')} ${l.name} ${num(l.qty)}${l.unit} × ${num(l.price)} = ${won(l.qty * l.price)}`).join('\n') + `\n\n합계 ${won(sum)}`;
    try { await navigator.clipboard.writeText(t); toast('복사했어요. 카톡에 붙여넣으세요'); } catch (e) { modal(`<h2>명세서 글</h2><textarea readonly>${esc(t)}</textarea>`); }
  },
  setMonth: (d, el) => { UI.month = el.value; render(); },
  payAdd: () => modal(`<h2>입금 기록</h2><div class="grid2">
    <div class="field"><label>조리원</label><select id="p-c">${DB.centers.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
    <div class="field"><label>어느 달 돈인지</label><input type="month" id="p-m" value="${UI.month}"></div>
    <div class="field"><label>입금일</label><input type="date" id="p-d" value="${today()}"></div>
    <div class="field"><label>금액</label><input type="number" inputmode="numeric" id="p-a" placeholder="원"></div></div>
    <div class="field" style="margin-top:12px"><label>메모</label><input id="p-memo"></div>`, b => {
      const a = Number(val(b, '#p-a')); if (!(a > 0)) { toast('금액을 넣어 주세요'); return false; }
      DB.payments.push({ id: uid(), centerId: val(b, '#p-c'), month: val(b, '#p-m'), date: val(b, '#p-d'), amount: a, memo: val(b, '#p-memo') }); save(); render(); toast('입금을 기록했어요');
    }),
  payDel: d => modal('<h2>이 입금 기록을 지울까요?</h2>', () => { DB.payments = DB.payments.filter(p => p.id !== d.v); save(); render(); }, '지우기'),
  unlock: () => { if ($('#pin').value === DB.settings.pin) { UI.unlocked = true; render(); } else toast('비밀번호가 달라요'); },
  setTab: d => { UI.setTab = d.v; render(); },
  itemQ: (d, el) => { UI.itemQ = el.value; render(); const i = $('#itemQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); },
  centerEdit: d => {
    const c = d.v ? center(d.v) : { name: '', contact: '', memo: '' };
    modal(`<h2>${d.v ? '조리원 수정' : '조리원 추가'}</h2><div class="field"><label>이름</label><input id="c-n" value="${esc(c.name)}"></div><div class="field" style="margin-top:12px"><label>담당자·연락처</label><input id="c-t" value="${esc(c.contact)}"></div><div class="field" style="margin-top:12px"><label>메모</label><input id="c-m" value="${esc(c.memo)}"></div>${d.v ? '<div class="row" style="margin-top:16px"><button class="btn t" data-a="centerDel" data-v="' + d.v + '" style="color:var(--red-700)">이 조리원 삭제</button></div>' : ''}`, b => {
      const n = val(b, '#c-n').trim(); if (!n) { toast('이름을 넣어 주세요'); return false; }
      if (d.v) Object.assign(c, { name: n, contact: val(b, '#c-t'), memo: val(b, '#c-m') }); else DB.centers.push({ id: uid(), name: n, contact: val(b, '#c-t'), memo: val(b, '#c-m') });
      save(); render();
    });
  },
  centerDel: d => {
    if (DB.orders.some(o => o.centerId === d.v && o.lines.length) || DB.externals.some(e => e.centerId === d.v)) return toast('거래 기록이 있어서 지울 수 없어요');
    DB.centers = DB.centers.filter(c => c.id !== d.v); DB.marginRules = DB.marginRules.filter(r => r.centerId !== d.v); document.querySelector('.modal-bg')?.remove(); save(); render();
  },
  itemEdit: d => {
    const i = d.v ? item(d.v) : { name: '', unit: '', price: '', freshoneName: '', aliases: '' };
    modal(`<h2>${d.v ? '품목 수정' : '품목 추가'}</h2><div class="grid2"><div class="field"><label>품목명</label><input id="i-n" value="${esc(i.name)}"></div><div class="field"><label>단위</label><input id="i-u" value="${esc(i.unit)}" placeholder="kg, 개, 팩"></div>
      <div class="field"><label>매입가 (프레시원)</label><input id="i-p" type="number" inputmode="numeric" value="${esc(i.price)}"></div><div class="field"><label>프레시원 상품명</label><input id="i-f" value="${esc(i.freshoneName)}"></div></div>
      <div class="field" style="margin-top:12px"><label>카톡 인식용 다른 이름 (띄어쓰기로 구분)</label><input id="i-a" value="${esc(i.aliases)}" placeholder="예: 미역 국미역"></div>
      ${d.v ? '<div class="row" style="margin-top:16px"><button class="btn t" data-a="itemDel" data-v="' + d.v + '" style="color:var(--red-700)">이 품목 삭제</button></div>' : ''}`, b => {
      const n = val(b, '#i-n').trim(), p = Number(val(b, '#i-p')); if (!n) { toast('품목명을 넣어 주세요'); return false; } if (!(p >= 0)) { toast('매입가를 넣어 주세요'); return false; }
      const data = { name: n, unit: val(b, '#i-u').trim(), price: p, freshoneName: val(b, '#i-f').trim(), aliases: val(b, '#i-a').trim() };
      if (d.v) { if (Number(i.price) !== p) toast(`매입가가 바뀌었어요 (${won(i.price)} → ${won(p)}). 새 주문부터 적용돼요`); Object.assign(i, data); } else DB.items.push({ id: uid(), ...data });
      save(); render();
    });
  },
  itemDel: d => { DB.items = DB.items.filter(i => i.id !== d.v); DB.marginRules = DB.marginRules.filter(r => r.itemId !== d.v); document.querySelector('.modal-bg')?.remove(); save(); render(); },
  ruleEdit: d => {
    const r = d.v ? DB.marginRules.find(x => x.id === d.v) : { scope: 'item', type: 'pct', value: 10, from: today() };
    const bg = modal(`<h2>${d.v ? '마진 규칙 수정' : '마진 규칙 추가'}</h2><div class="grid2">
      <div class="field"><label>단계</label><select id="r-s">${Object.entries(SCOPE_L).map(([k, l]) => `<option value="${k}" ${r.scope === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>적용 시작일</label><input type="date" id="r-f" value="${r.from}"></div>
      <div class="field" id="r-iw"><label>품목</label><select id="r-i">${DB.items.map(i => `<option value="${i.id}" ${r.itemId === i.id ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select></div>
      <div class="field" id="r-cw"><label>조리원</label><select id="r-c">${DB.centers.map(c => `<option value="${c.id}" ${r.centerId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label>방식</label><select id="r-t"><option value="pct" ${r.type === 'pct' ? 'selected' : ''}>% 붙이기</option><option value="won" ${r.type === 'won' ? 'selected' : ''}>원 붙이기</option><option value="price" ${r.type === 'price' ? 'selected' : ''}>판매가 직접</option></select></div>
      <div class="field"><label>값</label><input type="number" inputmode="decimal" id="r-v" value="${r.value}"></div></div>
      ${d.v && r.scope !== 'default' ? '<div class="row" style="margin-top:16px"><button class="btn t" data-a="ruleDel" data-v="' + d.v + '" style="color:var(--red-700)">이 규칙 삭제</button></div>' : ''}`, b => {
      const s = val(b, '#r-s'), v = Number(val(b, '#r-v')); if (!(v >= 0)) { toast('값을 넣어 주세요'); return false; }
      if (s === 'default' && (!d.v || r.scope !== 'default') && DB.marginRules.some(x => x.scope === 'default' && x.from === val(b, '#r-f') && x.id !== r.id)) { toast('같은 날짜의 기본 마진이 이미 있어요'); return false; }
      const data = { scope: s, type: val(b, '#r-t'), value: v, from: val(b, '#r-f'), itemId: ['item', 'itemCenter'].includes(s) ? val(b, '#r-i') : undefined, centerId: ['center', 'itemCenter'].includes(s) ? val(b, '#r-c') : undefined };
      if (d.v) Object.assign(r, data); else DB.marginRules.push({ id: uid(), ...data }); save(); render(); toast('마진을 저장했어요. 적용일부터 새 주문에 반영돼요');
    });
    const sync = () => { const s = bg.querySelector('#r-s').value; bg.querySelector('#r-iw').hidden = !['item', 'itemCenter'].includes(s); bg.querySelector('#r-cw').hidden = !['center', 'itemCenter'].includes(s); };
    bg.querySelector('#r-s').addEventListener('change', sync); sync();
  },
  ruleDel: d => { DB.marginRules = DB.marginRules.filter(r => r.id !== d.v); document.querySelector('.modal-bg')?.remove(); save(); render(); },
  preview: () => { const p = priceLine($('#pv-i').value, $('#pv-c').value, today()); $('#pv-out').textContent = `매입 ${won(p.cost)} → 판매 ${won(p.price)} · ${p.rule}`; },
  toggleDay: d => { const s = DB.settings.deliveryDays, k = Number(d.v); DB.settings.deliveryDays = s.includes(k) ? s.filter(x => x !== k) : [...s, k].sort(); save(); render(); },
  setRound: (d, el) => { DB.settings.round = Number(el.value); save(); toast('저장했어요'); },
  biz: (d, el) => { DB.settings.biz[d.k] = el.value; save(); toast('저장했어요'); },
  setPin: (d, el) => { DB.settings.pin = el.value.trim(); UI.unlocked = true; save(); toast(el.value ? '비밀번호를 걸었어요' : '잠금을 풀었어요'); },
  fo: (d, el) => { DB.settings.freshone[d.k] = el.value; save(); toast('저장했어요'); },
  backupSave: async () => {
    const s = JSON.stringify(DB, null, 1), name = '식자재장부_백업_' + today() + '.json';
    if (API?.saveFile) { if (await API.saveFile(name, s)) toast('백업했어요'); return; }
    try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([s], { type: 'application/json' })); a.download = name; a.click(); } catch (e) { toast('이 화면에선 저장이 안 돼요'); }
  },
  backupLoad: (d, el) => {
    const f = el.files[0]; if (!f) return; const rd = new FileReader();
    rd.onload = () => { try { const x = JSON.parse(rd.result); if (!x.centers || !x.items) throw 0; modal('<h2>백업으로 덮어쓸까요?</h2><p>지금 데이터는 사라져요.</p>', () => { DB = x; save(); render(); toast('불러왔어요'); }, '덮어쓰기'); } catch (e) { toast('백업 파일이 아니에요'); } };
    rd.readAsText(f);
  },
  clearRecords: () => modal('<h2>주문·외부 구매·입금 기록을 모두 지울까요?</h2><p>조리원, 품목, 마진은 남아요.</p>', () => { Object.assign(DB, { orders: [], externals: [], payments: [], purchases: [], sample: false }); save(); render(); toast('기록을 지웠어요'); }, '지우기'),
  clearAll: () => modal('<h2>전부 지울까요?</h2><p>조리원·품목·마진·기록이 모두 사라져요.</p>', () => { const s = DB.settings; DB = { ...sample(), centers: [], items: [], sample: false, settings: s }; DB.marginRules = [{ id: uid(), scope: 'default', type: 'pct', value: 10, from: '2000-01-01' }]; save(); render(); toast('지웠어요'); }, '전부 지우기'),
  openBackups: () => API?.openDataDir(),
  installUpdate: () => API?.installUpdate(),
  loadSample: () => modal('<h2>예시 데이터로 바꿀까요?</h2><p>지금 데이터는 사라져요.</p>', () => { DB = sample(); seedOrders(); save(); render(); }, '바꾸기'),
};
function confirmSoft() { toast('받을 값이 산 값보다 낮아요. 그래도 올렸어요'); return true; }

/* 예시 주문 (미리보기용) */
function seedOrders() {
  const days = []; const d0 = new Date(); d0.setDate(d0.getDate() - 30);
  for (let k = 0; k < 31; k++) { const d = new Date(d0); d.setDate(d0.getDate() + k); if (DB.settings.deliveryDays.includes(d.getDay())) days.push(ymd(d)); }
  const pick = (a, n) => a.slice().sort(() => Math.random() - .5).slice(0, n);
  days.forEach(date => DB.centers.forEach(c => { const o = { id: uid(), date, centerId: c.id, lines: [] }; pick(DB.items, 4 + (Math.random() * 3 | 0)).forEach(i => addLine(o, i.id, [1, 1.5, 2, 3][Math.random() * 4 | 0])); DB.orders.push(o); DB.purchases.push({ id: uid(), date, status: 'done' }); }));
  DB.purchases = DB.purchases.filter((p, k, a) => a.findIndex(x => x.date === p.date) === k);
  DB.externals.push({ id: uid(), date: days[days.length - 1] || today(), centerId: DB.centers[1].id, name: '활전복(대)', store: '시장', qty: 10, unit: '미', cost: 4500, price: 5200 });
  DB.payments.push({ id: uid(), centerId: DB.centers[0].id, month: month(days[0] || today()), date: today(), amount: 500000, memo: '계좌이체' });
  DB.marginRules.push({ id: uid(), scope: 'item', itemId: DB.items[1].id, type: 'pct', value: 15, from: '2026-01-01' });
  DB.marginRules.push({ id: uid(), scope: 'center', centerId: DB.centers[2].id, type: 'pct', value: 12, from: '2026-01-01' });
}

/* 이벤트 위임 */
document.addEventListener('click', e => { const t = e.target.closest('[data-a]'); if (t && A[t.dataset.a]) { e.preventDefault(); A[t.dataset.a](t.dataset, t, e); } });
document.addEventListener('change', e => { const t = e.target.closest('[data-c]'); if (t && A[t.dataset.c]) A[t.dataset.c](t.dataset, t, e); });
document.addEventListener('input', e => { const t = e.target.closest('[data-i]'); if (t && A[t.dataset.i]) A[t.dataset.i](t.dataset, t, e); });

/* 오류는 기록만 하고 화면은 계속 */
function reportError(msg) { try { API?.logError(msg); } catch (e) { } }
window.addEventListener('error', e => { reportError(e.message + ' @' + e.filename + ':' + e.lineno); toast('문제가 생겼어요. 같은 일이 계속되면 아들에게 알려주세요'); });
window.addEventListener('unhandledrejection', e => { reportError('promise: ' + (e.reason?.stack || e.reason)); });

/* 업데이트 알림 */
API?.onUpdate?.(u => {
  const el = $('#update');
  if (u.state === 'ready') { el.hidden = false; el.innerHTML = `<span>새 버전(${esc(u.version)})이 준비됐어요. 프로그램을 끄면 자동으로 설치돼요.</span><button class="btn p" data-a="installUpdate">지금 설치</button>`; }
});

(async () => {
  try { await load(); } catch (e) { reportError('load: ' + e.stack); DB = sample(); READONLY = true; toast('데이터를 못 읽었어요. 아들에게 알려주세요'); }
  if (!READONLY && DB.sample && !DB.orders.length) { seedOrders(); save(); }
  if (READONLY) document.body.insertAdjacentHTML('afterbegin', '<div class="warn" style="margin:0;border-radius:0">이 데이터는 더 새 버전 프로그램에서 만들어졌어요. 업데이트 전까지는 저장하지 않아요.</div>');
  render();
})();
