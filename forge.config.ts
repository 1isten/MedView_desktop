import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';

import pkg from './package.json';
import {
  icon,
  appName,
  appVersion,
  buildVersion,
  copyright,
} from './public/branding.json';

import fs from 'node:fs';
import url from 'node:url';
import path from 'node:path';

const __filename = import.meta.filename || url.fileURLToPath(import.meta.url);
const __dirname = import.meta.dirname || path.dirname(__filename);

const iconPath = icon ? path.dirname(path.join(__dirname, icon)) : '';
const config: ForgeConfig = {
  packagerConfig: {
    icon: iconPath && fs.existsSync(iconPath) ? icon : undefined,
    name: appName,
    appVersion,
    buildVersion,
    appCopyright: copyright || undefined,
    protocols: [
      // { name: appName, schemes: [appName.toLowerCase().replaceAll(' ', '-')] },
    ],
    asar: true,
    extraResource: [
      'LICENSE',
      'THIRD-PARTY-NOTICES',
      'public/volview',
      // ...
    ],
    ignore: [
      '^/.output/public/volview',
      '^/public/volview',
      '^/VolView',
      // ...
      '^/.gitmodules',
      '^/.gitignore',
      '^/.vscode',
      '^/.nuxt',
      '^/.data',
      '^/dist',
      '^/public',
      '^/app',
      '^/server',
      '^/shared',
      '^/i18n',
      '^/buf.lock',
      '^/buf.yaml',
      '^/buf.gen.yaml',
      '^/tsconfig.json',
      '^/nuxt.config.ts',
      '^/forge.config.ts',
      '^/README.md',
      // ...
      '^/electron/.*\.ts$',
      '^/node_modules/.cache',
      // ...
    ],
    extendInfo: {
      CFBundleDocumentTypes: [
        {
          CFBundleTypeName: 'DICOM File',
          CFBundleTypeRole: 'Viewer',
          LSHandlerRank: 'Owner',
          CFBundleTypeExtensions: ['dcm'],
          CFBundleTypeMIMETypes: ['application/dicom'],
          LSItemContentTypes: ['org.nema.dicom'],
        },
        {
          CFBundleTypeName: 'Folder',
          CFBundleTypeRole: 'Viewer',
          LSHandlerRank: 'Owner',
          LSItemContentTypes: ['public.folder'],
        },
      ],
    },
  },
  makers: [
    new MakerZIP({}, ['win32', 'darwin']),
  ],
  plugins: [
    // ...
  ],
  hooks: {
    packageAfterPrune: async (config, buildPath, electronVersion, platform, arch) => {
      fs.writeFileSync(path.resolve(buildPath, 'package.json'), JSON.stringify({
        name: appName,
        version: buildVersion,
        type: pkg.type,
        main: pkg.main,
      }));
    },
    postPackage: async (config, { outputPaths, platform, arch }) => {
      const outputPath = outputPaths[0];
      if (!outputPath) {
        return;
      }
      const resourcesDir = platform === 'win32' ? path.join(outputPath, 'resources') : path.join(outputPath, `${appName}.app`, 'Contents', 'Resources');
      if (fs.existsSync(resourcesDir)) {
        if (platform === 'darwin') {
          const keepLproj = [
            'en.lproj',
            // ...
          ];
          for (const entry of fs.readdirSync(resourcesDir)) {
            if (entry.endsWith('.lproj') && !keepLproj.includes(entry)) {
              fs.rmSync(path.join(resourcesDir, entry), { recursive: true, force: true });
            }
          }
        }
        const volviewDir = path.join(resourcesDir, 'volview');
        if (fs.existsSync(volviewDir)) {
          fs.copyFileSync('./VolView/LICENSE', path.join(volviewDir, 'LICENSE'));
        }
      }
    },
  },
};

export default config;
