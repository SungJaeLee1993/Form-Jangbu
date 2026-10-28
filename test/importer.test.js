'use strict';
const test = require('node:test');
const assert = require('node:assert');
const XLSX = require('xlsx');
const { parseWorkbook } = require('../src/importer');

// 실제 파일과 같은 모양의 가짜 거래처원장 (실데이터는 저장소에 넣지 않음)
function fakeLedger() {
  const rows = [
    ['기간 : 2024-01-01~2024-01-31, 거래처 : 테스트 조리원.본점'], [],
    ['구분', '일자', '코드', '제품명', '규격', '', '수 량', '단위', '단가', '과세', '비과세', '부가세', '합 계', '수 금', '현잔고'],
    ['[전  일]', '20231231', '', '', '', '', 0, '', 0, 0, 0, 0, 0, 0, 100000],
    ['[매  출]', '20240103', '101121', '베이컨(테스트)1kg', '1kg*6', '', 1, 'EA', 18000, 16364, 0, 1636, 18000, 0, 118000],
    ['[매  출]', '20240103', '108242', '청오이(국내산)ea', '', '', 5, 'EA', 2600, 0, 13000, 0, 13000, 0, 131000],
    ['[수  금]', '20240104', '', '', '', '', 0, '', 0, 0, 0, 0, 0, 100000, 31000],
    ['[증  정]', '20240108', '902027', '고구마(냉동)ea', '', '', 1, 'EA', 0, 0, 0, 0, 0, 0, 31000],
    ['', '', '', '', '', '', 7, '', '', 16364, 13000, 1636, 31000, 100000, '']
  ];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet');
  return XLSX.write(wb, { type: 'buffer', bookType: 'biff8' });
}
function fakeSales() {
  const rows = [['', '매   출   원   장'], [], ['', '조회기간: 2024년 11월 16일 ~ 2024년 11월 30일'],
    ['', '순번', '매출일자', '거래처코드', '거래처명', '차수', '상품코드', '상품명', '', '', '', '단위', '수량', '단가', '공급가', '부가세', '합계'],
    ['', 1, '2024-11-18', '00002', '테스트조리원(지점)', 1, 900024, '돈채(국내산)500g', '', '', '', 'EA', 2, 4500, 9000, 0, 9000],
    ['', 2, '2024-11-18', '00002', '테스트조리원(지점)', 1, 900029, '코다리(절단)', '', '', '', 'EA', 2, 20500, 37273, 3727, 41000],
    ['', '', '', '', '', '', '', '', '', '1 / 1']];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'biff8' });
}

test('거래처원장 xls 읽기: 이월·매출·과세·수금·증정', () => {
  const o = parseWorkbook(fakeLedger(), 'a.xls');
  assert.strictEqual(o.format, '거래처원장');
  assert.deepStrictEqual(o.centers, ['테스트 조리원.본점']);
  assert.deepStrictEqual(o.openings[0], { center: '테스트 조리원.본점', date: '2023-12-31', amount: 100000 });
  assert.strictEqual(o.lines.length, 3);
  assert.strictEqual(o.lines[0].taxable, true);
  assert.strictEqual(o.lines[1].taxable, false);
  assert.strictEqual(o.lines[2].kind, '증정');
  assert.strictEqual(o.payments[0].amount, 100000);
});
test('매출원장 xls 읽기: 거래처명·숫자 상품코드', () => {
  const o = parseWorkbook(fakeSales(), 'b.xls');
  assert.strictEqual(o.format, '매출원장');
  assert.strictEqual(o.lines.length, 2);
  assert.strictEqual(o.lines[0].code, '900024');
  assert.strictEqual(o.lines[1].taxable, true);
  assert.strictEqual(o.lines[0].center, '테스트조리원(지점)');
});
test('엉뚱한 파일은 경고', () => {
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['아무거나']]), 'x');
  const o = parseWorkbook(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), 'c.xlsx');
  assert.ok(o.warnings.length);
});
module.exports = { fakeLedger, fakeSales };
