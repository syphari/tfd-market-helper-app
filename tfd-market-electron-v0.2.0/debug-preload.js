// debug-preload.js
// Preload script for the global debug window. Exposes an API to
// request debug information from the main process and listen for
// log updates.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('debugAPI', {
  /** Request the current debug info: logs and metrics. */
  requestInfo: () => ipcRenderer.invoke('get-debug-info'),
  /** Listen for real-time debug log updates. */
  onDebugLog: (callback) => {
    ipcRenderer.on('debug-log', (_event, payload) => callback(payload));
  }
});