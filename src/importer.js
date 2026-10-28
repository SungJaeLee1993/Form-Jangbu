'use strict';
// 기존 프로그램에서 뽑은 엑셀(거래처원장, 매출원장) 읽기 → 화면 쪽에서 쓰기 쉬운 공통 형태로 변환
// 아버지가 직접 고른 파일만 읽는다(외부에서 받은 파일 자동 처리 없음).
const XLSX = require('xlsx');

const norm = s => String(s ?? '').replace(/\s+/g, '');
const HEAD = {
  kind: ['구분'],
  date: ['일자', '매출일자', '거래일자'],
  center: ['거래처명', '거래처'],
  code: ['코드', '상품코드', '제품코드'],
  name: ['제품명', '상품명', '품명'],
  spec: ['규격'],
  qty: ['수량'],
  unit: ['단위'],
  price: ['단가'],
  taxable: ['과세'],
  exempt: ['비과세', '면세'],
  supply: ['공급가', '공급가액'],
  vat: ['부가세', '세액'],
  total: ['합계', '금액'],
  paid: ['수금', '입금'],
  balance: ['현잔고', '잔액', '현잔액']
};

function toDate(v) {
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})(\d{2})(\d{2})$/) || s.match(/^(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if (typeof v === 'number' && v > 30000 && v < 80000) { const d = XLSX.SSF.parse_date_code(v); return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`; }
  return null;
}
const n = v => { const x = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[,\s원]/g, '')); return isFinite(x) ? x : 0; };
const codeStr = v => { if (v === '' || v == null) return ''; const s = typeof v === 'number' ? String(Math.round(v)) : String(v).trim(); return s; };

function findHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const cells = rows[r].map(norm);
    const has = k => HEAD[k].some(h => cells.includes(h));
    if (has('date') && has('name')) {
      const map = {};
      cells.forEach((c, i) => { for (const [k, hs] of Object.entries(HEAD)) if (map[k] == null && hs.includes(c)) map[k] = i; });
      // '과세'가 '비과세'에 먹히지 않게 정확히 일치하는 것만 씀 (위에서 includes 대신 정확 일치)
      return { row: r, map };
    }
  }
  return null;
}

function parseWorkbook(buf, fileName = '') {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const out = { file: fileName, format: '', centers: [], lines: [], payments: [], openings: [], warnings: [] };
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: '' });
    const h = findHeader(rows);
    if (!h) continue;
    const m = h.map;
    // 거래처원장: 첫 줄에 "거래처 : 이름"
    let fixedCenter = '';
    for (let r = 0; r < h.row; r++) {
      const t = rows[r].join(' ');
      const mm = t.match(/거래처\s*[:：]\s*([^,]+?)\s*(?:,|$)/);
      if (mm) fixedCenter = mm[1].trim();
    }
    out.format = m.kind != null ? '거래처원장' : '매출원장';
    for (let r = h.row + 1; r < rows.length; r++) {
      const row = rows[r];
      const date = toDate(row[m.date]);
      if (!date) continue; // 페이지 머리말, 합계 줄 등
      const kind = m.kind != null ? norm(row[m.kind]).replace(/[\[\]]/g, '') : '매출';
      const center = (m.center != null && String(row[m.center]).trim()) || fixedCenter || '거래처 미상';
      if (kind === '전일') { out.openings.push({ center, date, amount: n(row[m.balance]) }); continue; }
      if (kind === '수금') { out.payments.push({ center, date, amount: n(row[m.paid]) }); continue; }
      if (kind !== '매출' && kind !== '증정' && kind !== '반품') { out.warnings.push(`${r + 1}행 알 수 없는 구분: ${kind}`); continue; }
      const name = String(row[m.name] ?? '').trim();
      if (!name) continue;
      const qty = n(row[m.qty]);
      const price = n(row[m.price]);
      const vat = m.vat != null ? n(row[m.vat]) : 0;
      const taxableAmt = m.taxable != null ? n(row[m.taxable]) : 0;
      const total = m.total != null ? n(row[m.total]) : qty * price;
      out.lines.push({
        center, date, kind,
        code: m.code != null ? codeStr(row[m.code]) : '',
        name, spec: m.spec != null ? String(row[m.spec] ?? '').trim() : '',
        unit: String(row[m.unit] ?? '').trim() || 'EA',
        qty: kind === '반품' ? -Math.abs(qty) : qty,
        price: kind === '증정' ? 0 : price,
        taxable: vat > 0 || taxableAmt > 0,
        total: kind === '증정' ? 0 : total
      });
    }
  }
  out.centers = [...new Set([...out.lines, ...out.payments, ...out.openings].map(x => x.center))];
  if (!out.lines.length && !out.payments.length) out.warnings.push('읽을 수 있는 거래가 없어요. 거래처원장이나 매출원장 엑셀인지 확인해 주세요.');
  return out;
}

// 거래처원장 형태로 엑셀 만들기
function buildLedgerXlsx({ title, header, rows }) {
  const ws = XLSX.utils.aoa_to_sheet([[title], [], header, ...rows]);
  ws['!cols'] = header.map((h, i) => ({ wch: i === 2 ? 34 : 12 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '거래처원장');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { parseWorkbook, buildLedgerXlsx, toDate };
