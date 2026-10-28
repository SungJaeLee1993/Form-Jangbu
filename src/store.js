'use strict';
// 데이터 파일 저장소: 원자적 쓰기 + 날짜별 자동 백업 + 앱 버전이 바뀔 때 백업
const fs = require('fs');
const path = require('path');

const KEEP_DAILY = 30;

function createStore(dir) {
  const file = path.join(dir, 'data.json');
  const backupDir = path.join(dir, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });

  function load() {
    for (const f of [file, file + '.tmp']) {
      try {
        const s = fs.readFileSync(f, 'utf8');
        JSON.parse(s); // 깨진 파일이면 건너뜀
        return s;
      } catch (e) { /* 다음 후보 */ }
    }
    // 본 파일이 깨졌으면 가장 최근 백업에서 복구
    const latest = listBackups()[0];
    if (latest) {
      try { const s = fs.readFileSync(path.join(backupDir, latest), 'utf8'); JSON.parse(s); return s; } catch (e) { }
    }
    return null;
  }

  function save(json) {
    if (typeof json !== 'string') throw new TypeError('json must be a string');
    JSON.parse(json); // 잘못된 데이터는 저장하지 않음
    const tmp = file + '.tmp';
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeSync(fd, json); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
    dailyBackup(json);
    return true;
  }

  function dailyBackup(json) {
    const d = new Date();
    const name = `data-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
    fs.writeFileSync(path.join(backupDir, name), json);
    listBackups().filter(n => n.startsWith('data-')).slice(KEEP_DAILY).forEach(n => {
      try { fs.unlinkSync(path.join(backupDir, n)); } catch (e) { }
    });
  }

  function backupForVersion(appVersion) {
    const marker = path.join(dir, 'last-version.txt');
    let last = null;
    try { last = fs.readFileSync(marker, 'utf8').trim(); } catch (e) { }
    if (last && last !== appVersion && fs.existsSync(file)) {
      fs.copyFileSync(file, path.join(backupDir, `before-v${appVersion}-from-v${last}.json`));
    }
    fs.writeFileSync(marker, appVersion);
    return last;
  }

  function listBackups() {
    try { return fs.readdirSync(backupDir).filter(n => n.endsWith('.json')).sort().reverse(); } catch (e) { return []; }
  }

  return { file, backupDir, load, save, backupForVersion, listBackups };
}

module.exports = { createStore };
