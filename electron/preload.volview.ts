import { contextBridge, ipcRenderer, webUtils } from 'electron';

// ...

contextBridge.exposeInMainWorld('$electron', {

  // ...

  // async onLoaded() {
  //   return ipcRenderer.send('DOMContentLoaded');
  // },
});
