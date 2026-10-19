const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sof', {
  getState: () => ipcRenderer.invoke('state:get'),
  clearAlerts: () => ipcRenderer.invoke('alerts:clear'),
  forgetAgent: (host) => ipcRenderer.invoke('agents:forget', host),
  openConfig: () => ipcRenderer.invoke('config:open'),
  sendTest: () => ipcRenderer.invoke('ntfy:test'),
  setPause: (minutes) => ipcRenderer.invoke('pause:set', minutes),
  runChecks: () => ipcRenderer.invoke('checks:run'),
  onStatus: (fn) => ipcRenderer.on('status', (_e, status) => fn(status)),
  onAlert: (fn) => ipcRenderer.on('alert', (_e, alert) => fn(alert)),
});
