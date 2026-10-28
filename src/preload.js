'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('store:load'),
  save: json => ipcRenderer.invoke('store:save', json),
  info: () => ipcRenderer.invoke('app:info'),
  openDataDir: () => ipcRenderer.invoke('app:openDataDir'),
  saveFile: (name, text) => ipcRenderer.invoke('file:save', name, text),
  printPDF: name => ipcRenderer.invoke('print:pdf', name),
  printPaper: () => ipcRenderer.invoke('print:paper'),
  importXls: (name, bytes) => ipcRenderer.invoke('import:xls', name, bytes),
  exportXlsx: payload => ipcRenderer.invoke('export:xlsx', payload),
  aiRead: payload => ipcRenderer.invoke('ai:read', payload),
  freshone: payload => ipcRenderer.invoke('freshone:run', payload),
  logError: msg => ipcRenderer.invoke('log:error', String(msg).slice(0, 4000)),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: cb => ipcRenderer.on('update', (e, d) => cb(d))
});
