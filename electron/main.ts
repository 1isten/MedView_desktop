import { app, protocol, BrowserWindow, Menu, dialog, shell, ipcMain } from 'electron';
import type Electron from 'electron/main';

import os from 'node:os';
import fsPromises from 'node:fs/promises';
import fs from 'node:fs';
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

const platform = process.platform || os.platform();
const isMac = platform === 'darwin';
// const isWin = platform === 'win32';

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

if (process.argv.length >= 2) {
  const lastArg = process.argv[process.argv.length - 1];
  if (!lastArg.startsWith('.') && fs.existsSync(lastArg)) {
    const stat = fs.lstatSync(lastArg);
    if (stat.isFile() || stat.isDirectory()) {
      openFromPaths.push(normalizePath(lastArg));
    }
  }
}

const APP_URL = path.join(app.getAppPath(), '.output', 'public', 'index.html');
const VOLVIEW_URL = path.join(app.getAppPath(), '..', 'volview', 'index.html');

const createWindow = (openFromPath?: string) => {
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

app.on('open-file', (e, path) => {
  e.preventDefault();
  handleOpenFromPath(path);
});

app.whenReady().then(() => {

  // protocol.handle('connect', connectrpcHandler);
  protocol.handle('h3', req => handler(req));

  // ipcMain.handle('ping', () => 'PONG');
  ipcMain.handle('getVolViewURL', () => app.isPackaged ? VOLVIEW_URL : VOLVIEW_URL_DEV);
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
