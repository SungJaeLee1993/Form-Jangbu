'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { createStore } = require('../src/store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jangbu-'));

test('저장 후 다시 읽기', () => {
  const s = createStore(tmp());
  assert.strictEqual(s.load(), null);
  s.save('{"a":1}');
  assert.strictEqual(s.load(), '{"a":1}');
  assert.ok(s.listBackups().length === 1);
});
test('깨진 JSON은 저장 거부', () => {
  const s = createStore(tmp());
  assert.throws(() => s.save('{bad'));
});
test('본 파일이 깨지면 백업에서 복구', () => {
  const d = tmp(); const s = createStore(d);
  s.save('{"ok":true}');
  fs.writeFileSync(path.join(d, 'data.json'), '{broken');
  assert.strictEqual(s.load(), '{"ok":true}');
});
test('앱 버전이 바뀌면 업데이트 전 백업', () => {
  const d = tmp(); const s = createStore(d);
  s.backupForVersion('0.1.0'); s.save('{"v":1}');
  s.backupForVersion('0.2.0');
  assert.ok(s.listBackups().some(n => n.startsWith('before-v0.2.0-from-v0.1.0')));
});
