import { contextBridge, ipcRenderer, webUtils } from 'electron';

const openFromQueue: { path: string; isDirectory: boolean }[] = [];

ipcRenderer.on('open-from-path', (e, openFromPath: string, isDirectory?: boolean) => {
  openFromQueue.push({ path: openFromPath, isDirectory: !!isDirectory });
});

ipcRenderer.on('click-context-menu-item', (e, payload) => {
  window.postMessage({ type: 'click-context-menu-item', payload }, '*', e.ports);
});

contextBridge.exposeInMainWorld('$electron', {
  versions: () => ({
    chrome: process.versions.chrome,
    node: process.versions.node,
    electron: process.versions.electron,
  }),

  // ping: () => ipcRenderer.invoke('ping'),

  getVolViewURL: () => ipcRenderer.invoke('getVolViewURL'),
  openWithVolView: (filePath: string, fileName?: string, options?: { newWindow?: boolean }) => ipcRenderer.invoke('openWithVolView', filePath, fileName, window.btoa(encodeURIComponent(filePath)), options),

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
  pathExists() {
    return ipcRenderer.invoke('pathExists', ...arguments);
  },
  readDirs() {
    return ipcRenderer.invoke('readDirs', ...arguments);
  },
  readDirectory() {
    return ipcRenderer.invoke('readDirectory', ...arguments);
  },

  // ...

  async getThirdpartyModules() {
    return ipcRenderer.invoke('getThirdpartyModules', ...arguments);
  },
  async getThirdpartyModule() {
    return ipcRenderer.invoke('getThirdpartyModule', ...arguments);
  },
  async clickThirdpartyModuleContextMenu(moduleId: string, ...args: any[]) {
    return ipcRenderer.invoke(`${moduleId}/@contextmenu`, ...args);
  },
  openThirdpartyModuleUI() {
    ipcRenderer.send('openThirdpartyModuleUI', ...arguments);
  },

  // ...

  getPathForFile(file: File) {
    return webUtils.getPathForFile(file);
  },

  handleOpenFromPath() {
    return openFromQueue.pop() || null;
  },
});
