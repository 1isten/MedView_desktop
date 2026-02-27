import * as esbuild from 'esbuild';

(async function build() {
  await Promise.all([
    // esbuild electron/main.ts --format=esm --platform=node --minify --bundle --packages=external --outdir=electron --allow-overwrite
    esbuild.build({
      entryPoints: ['electron/main.ts'],
      format: 'esm',
      platform: 'node',
      minify: true,
      bundle: true,
      packages: 'external',
      outdir: 'electron',
      allowOverwrite: true,
    }),
    // esbuild electron/preload.ts --format=cjs --minify --outdir=electron --allow-overwrite
    esbuild.build({
      entryPoints: ['electron/preload.ts'],
      format: 'cjs',
      minify: true,
      outdir: 'electron',
      allowOverwrite: true,
    }),
  ]);
})();
