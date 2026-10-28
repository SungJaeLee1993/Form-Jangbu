'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const log = require('electron-log/main');
const { autoUpdater } = require('electron-updater');
const { createStore } = require('./store');

log.initialize();
log.transports.file.level = 'info';
process.on('uncaughtException', e => log.error('uncaughtException', e));
process.on('unhandledRejection', e => log.error('unhandledRejection', e));

// 두 번 실행 방지
if (!app.requestSingleInstanceLock()) { app.quit(); }

let win = null;
let store = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 900, minWidth: 1024, minHeight: 700,
    title: '식자재 장부',
    autoHideMenuBar: true,
    backgroundColor: '#f9fafb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // 외부 링크는 기본 브라우저로
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.on('render-process-gone', (e, d) => log.error('renderer gone', d));
}

/* ---------- 자동 업데이트 ---------- */
function sendUpdate(state, info = {}) { win?.webContents.send('update', { state, ...info }); }
function setupUpdater() {
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;          // 뒤에서 조용히 받고
  autoUpdater.autoInstallOnAppQuit = true;  // 프로그램 끌 때 설치
  autoUpdater.on('update-available', i => sendUpdate('downloading', { version: i.version }));
  autoUpdater.on('update-downloaded', i => sendUpdate('ready', { version: i.version }));
  autoUpdater.on('error', e => log.warn('updater error', e?.message)); // 인터넷 없을 때 등 — 사용자에게는 안 띄움
  const check = () => autoUpdater.checkForUpdates().catch(e => log.warn('update check failed', e?.message));
  setTimeout(check, 5000);
  setInterval(check, 4 * 60 * 60 * 1000);
}

/* ---------- IPC ---------- */
function setupIpc() {
  ipcMain.handle('store:load', () => store.load());
  ipcMain.handle('store:save', (e, json) => store.save(json));
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), dataDir: app.getPath('userData'), backups: store.listBackups().slice(0, 10) }));
  ipcMain.handle('app:openDataDir', () => shell.openPath(store.backupDir));
  ipcMain.handle('update:install', () => { setImmediate(() => autoUpdater.quitAndInstall(true, true)); return true; });
  ipcMain.handle('log:error', (e, msg) => { log.error('[renderer]', msg); return true; });

  ipcMain.handle('file:save', async (e, name, text) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), name), filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return false;
    fs.writeFileSync(r.filePath, text, 'utf8');
    return true;
  });

  ipcMain.handle('print:pdf', async (e, name) => {
    const safe = String(name).replace(/[\\/:*?"<>|]/g, '_');
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), safe + '.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePath) return false;
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { marginType: 'default' } });
    fs.writeFileSync(r.filePath, pdf);
    shell.openPath(r.filePath);
    return true;
  });
  ipcMain.handle('print:paper', () => new Promise(res => win.webContents.print({ printBackground: true }, ok => res(ok))));

  ipcMain.handle('freshone:run', async (e, payload) => {
    const freshone = require('./freshone'); // 필요할 때만 불러옴
    return freshone.run(payload, log);
  });
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  store = createStore(app.getPath('userData'));
  const prev = store.backupForVersion(app.getVersion());
  log.info('start', app.getVersion(), 'prev', prev);
  setupIpc();
  createWindow();
  if (app.isPackaged) setupUpdater();
});
app.on('window-all-closed', async () => {
  try { await require('./freshone').close(); } catch (e) { }
  app.quit();
});
