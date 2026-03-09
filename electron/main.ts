import { app, protocol, BrowserWindow, Menu, dialog, shell, ipcMain } from 'electron';
import type Electron from 'electron/main';

import os from 'node:os';
import fsPromises from 'node:fs/promises';
import fs from 'node:fs';
import url from 'node:url';
import path from 'node:path';
import { normalizePath } from '../server/utils/path';
import { pathExists, readDirs } from '../server/utils/fs';

// import { handler as connectrpcHandler } from '../server/trpc';
import { handler } from '../server';

import {
  DEBUG,
  APP_URL_DEV,
  VOLVIEW_URL_DEV,
} from '../app/constants';

const __filename = import.meta.filename || url.fileURLToPath(import.meta.url);
const __dirname = import.meta.dirname || path.dirname(__filename);

const platform = process.platform || os.platform();
const isMac = platform === 'darwin';
// const isWin = platform === 'win32';

const modules: Record<string, any> = {/* registered thirdparty modules ... */};
const thirdparty_modules = path.join(app.isPackaged ? app.getAppPath() : __dirname, '..', 'thirdparty_modules');
if (fs.existsSync(thirdparty_modules)) {
  fs.readdirSync(thirdparty_modules).forEach((author: string) => {
    if (author.startsWith('@')) {
      fs.readdirSync(path.join(thirdparty_modules, author)).forEach((mod: string) => {
        const main = path.join(thirdparty_modules, author, mod, 'main.js');
        if (fs.existsSync(main)) {
          import(url.pathToFileURL(main).href).then(async ({ default: module }) => {
            const moduleId = `${author}/${mod}`;
            const { setup, api, ...moduleProps } = module;
            if (setup && typeof setup === 'function') {
              await setup({}, app);
            }
            if (api && typeof api === 'object') {
              Object.entries(api).forEach(([api, handler]) => {
                if (typeof handler === 'function') {
                  ipcMain.handle(`${moduleId}/${api}`, (e, ...args) => handler(...args));
                }
              });
            }
            modules[moduleId] = { ...moduleProps };
          }).catch(console.error);
        }
      });
    }
  });
}

const menuTemplate = [
  // { role: 'appMenu' }
  ...(isMac
    ? [{
      label: app.name,
      submenu: [
        // { role: 'about' },
        // { type: 'separator' },
        // { role: 'services' },
        // { type: 'separator' },
        // { role: 'hide' },
        // { role: 'hideOthers' },
        // { role: 'unhide' },
        // { type: 'separator' },
        { role: 'quit' },
      ],
    }]
    : []),
  // { role: 'viewMenu' }
  {
    label: 'View',
    submenu: [
      ...(app.isPackaged && !DEBUG ? [] : [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
      ]),
      { role: 'resetZoom', accelerator: 'CmdOrCtrl+0' },
      { role: 'zoomIn', accelerator: 'CmdOrCtrl+=' },
      { role: 'zoomOut', accelerator: 'CmdOrCtrl+-' },
    ],
  },
  // { role: 'windowMenu' }
  {
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      // { role: 'zoom' },
      ...(isMac
        ? [
          // { type: 'separator' },
          // { role: 'front' },
          // { type: 'separator' },
          // { role: 'window' },
        ]
        : [
          { role: 'close' },
        ])
    ],
  },
] as (Electron.MenuItemConstructorOptions | Electron.MenuItem)[];
const menu = Menu.buildFromTemplate(menuTemplate);
Menu.setApplicationMenu(menu);

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'connect', // connect://localhost
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
  {
    scheme: 'h3', // h3://localhost
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

if (app.isPackaged) {
  // ...
} else {
  Object.assign(process.env, {
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
  });
}

const openFromPaths: string[] = [];

const commandLine = process.argv;
if (commandLine.length >= 2) {
  const lastArg = commandLine[commandLine.length - 1];
  if (!lastArg.startsWith('.') && fs.existsSync(lastArg)) {
    const stat = fs.lstatSync(lastArg);
    if (stat.isFile() || stat.isDirectory()) {
      openFromPaths.push(normalizePath(lastArg));
    }
  }
}

const additionalData = {
  // ...
};
const gotTheLock = app.requestSingleInstanceLock(additionalData);
if (!gotTheLock) {
  app.quit();
} else {
  // win
  app.on('second-instance', (e, commandLine, workingDirectory, additionalData) => {
    if (commandLine.length >= 2) {
      const lastArg = commandLine[commandLine.length - 1];
      if (!lastArg.startsWith('.') && fs.existsSync(lastArg)) {
        const stat = fs.lstatSync(lastArg);
        if (stat.isFile() || stat.isDirectory()) {
          openFromPaths.push(normalizePath(lastArg));
        }
      }
    }
    createWindow(openFromPaths.pop());
  });

  // mac
  app.on('open-file', (e, path) => {
    e.preventDefault();
    handleOpenFromPath(path);
  });
  app.on('open-url', (e, url) => {
    e.preventDefault();
    // ...
  });
}

const APP_URL = path.join(app.getAppPath(), '.output', 'public', 'index.html');
const VOLVIEW_URL = path.join(app.getAppPath(), '..', 'volview', 'index.html');
const getVolViewURL = () => app.isPackaged ? VOLVIEW_URL : VOLVIEW_URL_DEV;

const createWindow = (openFromPath?: string) => {
  if (!gotTheLock) {
    return;
  }

  const win = new BrowserWindow({
    darkTheme: true,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    useContentSize: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      devTools: app.isPackaged ? !!DEBUG : true,
    },
  });

  if (app.isPackaged) {
    win.loadFile(APP_URL);
  } else {
    win.loadURL(APP_URL_DEV);
    win.webContents.openDevTools();
  }

  if (openFromPath) {
    win.webContents.send('open-from-path', openFromPath, fs.lstatSync(openFromPath).isDirectory());
  }
  return win;
};

function handleOpenFromPath(openFromPath: string) {
  if (fs.existsSync(openFromPath)) {
    openFromPath = normalizePath(openFromPath);
  } else {
    return;
  }
  if (app.isReady()) {
    createWindow(openFromPath);
  } else {
    openFromPaths.push(openFromPath);
  }
}

app.whenReady().then(() => {
  if (!gotTheLock) {
    return;
  }

  // protocol.handle('connect', connectrpcHandler);
  protocol.handle('h3', req => handler(req));

  // ipcMain.handle('ping', () => 'PONG');
  ipcMain.handle('getVolViewURL', () => getVolViewURL());
  ipcMain.handle('openWithVolView', (e, filePath: string, fileName?: string, uid?: string) => {
    const isDICOM = fileName?.toLowerCase().endsWith('.dcm') || (fileName && !fileName.includes('.'));
    const isNIFTI = fileName?.toLowerCase().endsWith('.nii') || fileName?.toLowerCase().endsWith('.nii.gz');
    const url = getVolViewURL()
      + `?urls=[h3://localhost/file/${encodeURIComponent(filePath)}]`
      + (fileName ? `&names=[${fileName}]` : '')
      + (uid ? `&uid=${uid}&atob=true` : '')
      + (isDICOM ? '&changeLayout=auto' : fileName ? `&layoutName=${isNIFTI ? 'Axial Primary' : 'Axial Only'}` : '');
      + '&roi=true'
    const win = new BrowserWindow({
      darkTheme: true,
      backgroundColor: '#000000',
      autoHideMenuBar: true,
      width: 1080,
      height: 720,
      minWidth: 500,
      minHeight: 500,
      useContentSize: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.volview.js'),
        devTools: app.isPackaged ? !!DEBUG : true,
      },
    });
    if (url.startsWith('http')) {
      win.loadURL(url);
    } else {
      win.loadFile(url);
    }
    return url;
  });
  ipcMain.on('showContextMenu', (e, ...args) => {
    const { key, val } = args[0];
    const template: (Electron.MenuItemConstructorOptions | Electron.MenuItem)[] = [];
    const buildTemplate = (temp: typeof template = [], items: typeof template = [], indexes = '') => {
      items.forEach((item, i) => {
        if (item.type === 'separator') {
          temp.push({ type: 'separator' });
          return;
        }
        if (item.submenu && Array.isArray(item.submenu)) {
          const submenu: Electron.MenuItemConstructorOptions[] = [];
          temp.push({
            label: item.label,
            submenu,
          });
          buildTemplate(submenu, item.submenu, indexes + `${i}.`);
        } else {
          temp.push({
            label: item.label,
            enabled: item.enabled,
            click: () => e.sender.send('click-context-menu-item', { key, indexes: indexes + `${i}` }),
          });
        }
      });
    };
    buildTemplate(template, val);
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: BrowserWindow.fromWebContents(e.sender) || undefined });
  });
  ipcMain.on('showInFolder', (e, fullPath: string, openFolder = false) => {
    if (fullPath && fs.existsSync(fullPath)) {
      if (openFolder && fs.lstatSync(fullPath).isDirectory()) {
        shell.openPath(fullPath);
      } else {
        shell.showItemInFolder(fullPath);
      }
    }
  });
  ipcMain.handle('showOpenDialog', async (e, options: Electron.OpenDialogOptions) => dialog.showOpenDialog(options));
  ipcMain.handle('pathExists', async (e, fullPath: string) => pathExists(fullPath));
  ipcMain.handle('readDirs', async (e, fullPaths: string[]) => readDirs(fullPaths));
  ipcMain.handle('readDirectory', async (e, folderPath: string) => {
    const folders: any[] = [];
    const files: any[] = [];
    const access = await pathExists(folderPath);
    if (!access) {
      return [folders, files];
    }
    const relativePaths = await fsPromises.readdir(folderPath);
    for (const relativePath of relativePaths) {
      const fullPath = normalizePath(path.join(folderPath, relativePath));
      const [_folders, _files] = await readDirs([fullPath]);
      folders.push(..._folders);
      files.push(..._files);
    }
    return [folders, files];
  });

  // ...

  ipcMain.handle('getThirdpartyModules', async (e, ui = true, ...args) => {
    const thirdpartyModules: any[] = [];
    Object.keys(modules).sort((a, b) => a.localeCompare(b)).forEach(moduleId => {
      const moduleProps = modules[moduleId];
      if (ui) {
        if (!!moduleProps.ui) {
          thirdpartyModules.push({ id: moduleId, ...moduleProps });
        }
      } else {
        thirdpartyModules.push({ id: moduleId, ...moduleProps });
      }
    });
    return JSON.parse(JSON.stringify(thirdpartyModules));
  });
  ipcMain.handle('getThirdpartyModule', async (e, moduleId: string, ...args) => {
    return modules[moduleId] ? JSON.parse(JSON.stringify({ moduleId, ...modules[moduleId] })) : null;
  });
  ipcMain.on('openThirdpartyModuleUI', (e, moduleId: string, ...args) => {
    const module = modules[moduleId];
    if (module?.ui?.entry) {
      const ui = path.isAbsolute(module.ui.entry) ? module.ui.entry : path.join(thirdparty_modules, moduleId, module.ui.entry);
      if (fs.existsSync(ui)) {
        const win = new BrowserWindow({
          darkTheme: true,
          backgroundColor: '#212121',
          autoHideMenuBar: true,
          ...(module.ui.windowOptions ?? {}),
          useContentSize: true,
          webPreferences: {
            preload: path.join(__dirname, 'preload.mod.js'),
            devTools: app.isPackaged ? !!DEBUG : true,
          },
          show: false,
        });
        win.webContents.on('ipc-message', (e, channel) => {
          if (channel === 'DOMContentLoaded') {
            if (args.length > 0) {
              win.webContents.send('load-args', ...args);
            }
            win.show();
          }
        });
        win.loadFile(ui);
      }
    }
  });

  // ...

  createWindow(openFromPaths.pop());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(openFromPaths.pop());
    }
  });
});

app.on('window-all-closed', () => {
  if (isMac) {
    // return;
  }
  app.quit();
});
