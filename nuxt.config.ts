import { copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, posix, dirname } from 'node:path';
import { normalizePath } from 'vite';
import vuetifyOptions from './app/vuetify.config';

const require = createRequire(import.meta.url);
const __filename = import.meta.filename || fileURLToPath(import.meta.url);
const __dirname = import.meta.dirname || dirname(__filename);

function resolvePath(...args: string[]) {
  return normalizePath(resolve(...args));
}
function resolveNodeModulePath(moduleName: string) {
  let modulePath = normalizePath(require.resolve(moduleName));
  while (!modulePath.endsWith(moduleName)) {
    const newPath = posix.dirname(modulePath);
    if (newPath === modulePath) throw new Error(`Could not resolve ${moduleName}`);
    modulePath = newPath;
  }
  return modulePath;
}

// copy static files
[
  {
    src: resolvePath(resolveNodeModulePath('dcmjs-imaging'), 'build', 'dcmjs-native-codecs.wasm'),
    dest: resolvePath(__dirname, 'public', 'dcmjs-native-codecs.wasm'),
  },
].forEach(({ src, dest }) => copyFileSync(src, dest));

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  ...(process.env.NODE_ENV === 'production' ? {
    ssr: false,
    app: {
      baseURL: '.',
      buildAssetsDir: '/assets/',
    },
    router: {
      options: {
        hashMode: true,
      },
    },
  } : {
    devServer: {
      port: 3000,
    },
  }),

  vuetify: {
    vuetifyOptions,
  },

  modules: ['@nuxt/ui', '@nuxtjs/i18n', '@pinia/nuxt', '@vueuse/nuxt', 'vuetify-nuxt-module'],
  css: ['~/assets/css/main.css', '@mdi/font/css/materialdesignicons.css', 'overlayscrollbars/overlayscrollbars.css'],

  fonts: {
    providers: {
      google: false,
      googleicons: false,
      fontshare: false,
    },
    priority: ['fontsource', 'bunny'],
  },
  colorMode: {
    preference: 'dark',
    fallback: 'dark',
    storage: 'sessionStorage',
  },
  ui: {
    theme: {
      colors: [
        'primary',
        'secondary',
        'tertiary', // extra
        'success',
        'info',
        'warning',
        'error',
      ],
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: [
      { code: 'en', language: 'en-US', name: 'English', file: 'en.json' },
    ],
    baseUrl: 'http://localhost:3000',
  },

  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
});
