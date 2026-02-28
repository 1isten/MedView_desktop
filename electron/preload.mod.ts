import { contextBridge, ipcRenderer, webUtils } from 'electron';

ipcRenderer.on('load-args', async (e, ...args) => {
  window.postMessage({ type: 'load-args', args }, '*', e.ports);
});

ipcRenderer.on('click-context-menu-item', async (e, payload) => {
  window.postMessage({ type: 'click-context-menu-item', payload }, '*', e.ports);
});

contextBridge.exposeInMainWorld('$electron', {
  versions: () => ({
    chrome: process.versions.chrome,
    node: process.versions.node,
    electron: process.versions.electron,
  }),

  // ...

  getVolViewURL: () => ipcRenderer.invoke('getVolViewURL'),

  // ...

  showContextMenu() {
    ipcRenderer.send('showContextMenu', ...arguments);
  },
  showInFolder() {
    ipcRenderer.send('showInFolder', ...arguments);
  },
  showOpenDialog() {
    return ipcRenderer.invoke('showOpenDialog', ...arguments);
  },

  // ...

  getPathForFile(file: File) {
    return webUtils.getPathForFile(file);
  },

  // ...

  async api(apiKey: string, ...args: any[]) {
    return ipcRenderer.invoke(apiKey, ...args);
  },

  async onLoaded() {
    return ipcRenderer.send('DOMContentLoaded');
  },
});
