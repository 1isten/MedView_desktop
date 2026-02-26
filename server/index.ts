import { createApp, createRouter, defineEventHandler, serveStatic, getQuery, readBody, setResponseHeader, sendStream, toWebHandler } from 'h3';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import { stat, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, basename, extname, join } from 'node:path';
import { normalizePath } from './utils/path';
import { pathExists } from './utils/fs';

// @ts-ignore
import dcmjs from 'dcmjs';
import { encode } from '@msgpack/msgpack';

// helper function
function createLimiter(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const run = () => {
        active++;
        fn().then(resolve, reject).finally(() => {
          active--;
          if (queue.length) queue.shift()!();
        });
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
  };
}

const app = createApp({
  debug: false,
});

const router = createRouter();

// router.get('/api/ping', defineEventHandler(async event => 'PONG'));
router.post('/api/parse', defineEventHandler(async event => {
  setResponseHeader(event, 'Content-Type', 'application/vnd.msgpack');
  setResponseHeader(event, 'Transfer-Encoding', 'chunked');
  setResponseHeader(event, 'Cache-Control', 'no-cache');

  const body = await readBody(event);
  const rootPaths = ((body.rootPaths || []) as string[]).map((rootPath: string) => {
    if (rootPath && existsSync(rootPath)) {
      return normalizePath(rootPath);
    }
    return '';
  }).filter(Boolean);
  const deep = !!body.deep;
  const refresh = !!body.refresh;

  const stream = new ReadableStream({
    async start(controller) {
      const limit = createLimiter(16);
      await handlePaths(rootPaths, '*');
      async function handlePaths(fullPaths: string[], rootPath?: string) {
        await Promise.all(fullPaths.map(async (fullPath) => {
          const access = await pathExists(fullPath);
          if (!access) {
            return;
          }
          const fileStat = await stat(fullPath).catch(() => {});
          if (!fileStat || fileStat.isSymbolicLink()) {
            return;
          }
          if (rootPath === '*') {
            const cacheFolder = join(fileStat.isDirectory() ? fullPath : dirname(fullPath), '.pmtaro', 'cache', 'parsing');
            if (refresh && cacheFolder && existsSync(cacheFolder)) {
              rmSync(cacheFolder, { recursive: true, force: true });
            }
            if (!existsSync(cacheFolder)) {
              mkdirSync(cacheFolder, { recursive: true });
            }
          }
          if (fileStat.isDirectory()) {
            const subPaths = await readdir(fullPath);
            const subFullPaths = subPaths.map(relativePath => join(fullPath, relativePath));
            await handlePaths(subFullPaths, rootPath === '*' ? fullPath : rootPath);
          } else if (fileStat.isFile()) {
            const fileName = basename(fullPath);
            const filePath = normalizePath(fullPath);
            await limit(() => handleFile(fileName, filePath, fileStat.size, fileStat.mtimeMs, rootPath === '*' ? dirname(fullPath) : rootPath));
          }
        }));
      }
      async function handleFile(fileName: string, filePath: string, fileSize: number, fileMtimeMs: number, rootPath?: string) {
        if (
          fileName.startsWith('.') ||
          fileName.endsWith('.lnk')
        ) {
          return;
        }
        const type = extname(fileName).toLowerCase();
        if (type === '' || type === '.dcm' || type === '.dicom') {
          try {
            const cacheName = `${filePath.slice((rootPath || '').length)}|${fileSize}|${fileMtimeMs}`;
            const cacheNameHashed = createHash('md5').update(cacheName).digest('hex') + '.json';
            const cacheFolder = rootPath ? join(rootPath, '.pmtaro', 'cache', 'parsing') : null;

            // read cache
            if (cacheFolder && existsSync(cacheFolder)) {
              const cacheFile = join(cacheFolder, cacheNameHashed);
              if (existsSync(cacheFile)) {
                const cacheContent = await readFile(cacheFile, { encoding: 'utf-8' });
                if (cacheContent) {
                  const payload = JSON.parse(cacheContent);
                  controller.enqueue(encode(payload));
                  return; // hit cache
                }
              }
            }

            // stream the file through AsyncDicomReader — no full buffer in memory
            const reader = new dcmjs.async.AsyncDicomReader();
            reader.stream.fromAsyncStream(createReadStream(filePath));
            await reader.readFile();
            const meta = reader.meta;
            const dict = reader.dict;
            if (meta && dict) {
              let PixelData = dict['7FE00010']?.Value;
              if (PixelData) {
                let length = 0;
                for (const fragment of PixelData) {
                  if (!fragment) continue;
                  if (fragment.byteLength !== undefined) {
                    length += fragment.byteLength;
                  } else if (fragment.length !== undefined) {
                    length += fragment.length;
                  }
                }
                if (length === 0) {
                  PixelData = null;
                } else {
                  // optional: double check Rows/Columns exist
                  const Rows = dict['00280010']?.Value?.[0];
                  const Columns = dict['00280011']?.Value?.[0];
                  if (!Rows || !Columns) {
                    PixelData = null;
                  }
                }
              }

              // TODO: maybe add more filter conditions to filter non-supported dcm files
              // ...

              if (PixelData) {
                let TransferSyntaxUID = meta['00020010']?.Value?.[0];
                let SOPClassUID = meta['00020002']?.Value?.[0];

                // ...
                
                let PatientName = dict['00100010']?.Value;
                if (PatientName?.__hasValueAccessors) {
                  PatientName = PatientName.toString();
                } else {
                  PatientName = PatientName?.[0];
                }
                if (PatientName && typeof PatientName === 'object') {
                  // AsyncDicomReader returns PN as DICOM JSON: { Alphabetic, Ideographic, Phonetic }
                  PatientName = PatientName.Alphabetic ?? PatientName.Ideographic ?? PatientName.Phonetic ?? '';
                }

                let PatientID = dict['00100020']?.Value?.[0];

                let StudyInstanceUID = dict['0020000D']?.Value?.[0];
                let StudyDescription = dict['00081030']?.Value?.[0];
                let StudyID = dict['00200010']?.Value?.[0];
                let StudyDate = dict['00080020']?.Value?.[0];
                let StudyTime = dict['00080030']?.Value?.[0];

                let SeriesInstanceUID = dict['0020000E']?.Value?.[0];
                let SeriesDescription = dict['0008103E']?.Value?.[0];
                let SeriesNumber = dict['00200011']?.Value?.[0];

                let SOPInstanceUID = dict['00080018']?.Value?.[0];
                let InstanceNumber = dict['00200013']?.Value?.[0];

                // may collect more tags
                // ...

                const payload: any = {
                  name: fileName,
                  path: filePath,
                  root: rootPath,
                  type: 'application/dicom',
                  tags: {
                    TransferSyntaxUID,
                    SOPClassUID,

                    // ...

                    PatientName,
                    PatientID,

                    StudyInstanceUID,
                    StudyDescription,
                    StudyID,
                    StudyDate,
                    StudyTime,

                    SeriesInstanceUID,
                    SeriesDescription,
                    SeriesNumber,

                    SOPInstanceUID,
                    InstanceNumber,
                  },
                  // Subset of those listed at:
                  // http://dicom.nema.org/medical/dicom/current/output/html/part04.html#sect_B.5
                  isVolume: [
                    '1.2.840.10008.5.1.4.1.1.2.1', // Enhanced CT Image Storage
                    '1.2.840.10008.5.1.4.1.1.4.1', // Enhanced MR Image Storage
                    '1.2.840.10008.5.1.4.1.1.4.3', // Enhanced MR Color Image
                    '1.2.840.10008.5.1.4.1.1.6.2', // Enhanced US Volume
                    '1.2.840.10008.5.1.4.1.1.12.1.1', // Enhanced XA Image Storage
                    '1.2.840.10008.5.1.4.1.1.12.2.1', // Enhanced XRF Image Storage
                    '1.2.840.10008.5.1.4.1.1.88.22', // Enhanced SR
                    '1.2.840.10008.5.1.4.1.1.130', // EnhancedPETImage
                    // ...
                  ].includes(SOPClassUID),
                };

                // write cache
                if (cacheFolder && existsSync(cacheFolder)) {
                  const cacheFile = join(cacheFolder, cacheNameHashed);
                  payload.cacheFile = cacheFile;
                  await writeFile(cacheFile, JSON.stringify(payload), { encoding: 'utf-8' }).catch(() => {});
                }

                controller.enqueue(encode(payload));
              }
            }
          } catch (err) {
            console.error('cannot parse', filePath, err);
          }
        } else {
          // TODO: support more file types
          // ...
        }
      }
      controller.close();
    },
  });
  return sendStream(event, stream);
}));

router.post('/api/cache-thumbnail', defineEventHandler(async event => {
  const body = await readBody(event);
  const cacheFile = body.cacheFile as string;
  const dataURL = body.dataURL as string;
  const width = body.width as number;
  const height = body.height as number;
  if (dataURL && width && height && cacheFile && existsSync(cacheFile)) {
    const cacheContent = await readFile(cacheFile, { encoding: 'utf-8' });
    if (cacheContent) {
      const payload = JSON.parse(cacheContent);
      payload.thumbnail = {
        dataURL,
        width,
        height,
      };
      await writeFile(cacheFile, JSON.stringify(payload), { encoding: 'utf-8' }).catch(() => {});
      return payload;
    }
  }
  return { thumbnail: null };
}));

router.delete('/api/cache-clear', defineEventHandler(async event => {
  const body = await readBody(event);
  const rootPaths = (body.rootPaths || []) as string[];
  return Promise.all(rootPaths.map(async (rootPath: string) => {
    if (rootPath && existsSync(rootPath)) {
      const fileStat = await stat(rootPath);
      const cacheFolder = join(fileStat.isDirectory() ? rootPath : dirname(rootPath), '.pmtaro');
      if (cacheFolder && existsSync(cacheFolder)) {
        rmSync(cacheFolder, { recursive: true, force: true });
        return { root: rootPath, cache: 0 };
      }
    }
    return { root: rootPath, cache: 1 };
  }));
}));

router.get('/file/**', defineEventHandler(async event => {
  const path = normalizePath(event.context.params?._ && decodeURIComponent(event.context.params._));
  const name = getQuery(event).filename ? decodeURIComponent(getQuery(event).filename as string) : '';
  const pdf = name && name.toLowerCase().endsWith('.pdf');
  if (name) {
    setResponseHeader(event, 'content-disposition', `${pdf ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`);
  }
  return serveStatic(event, {
    getContents: id => path ? readFile(path) : undefined,
    getMeta: async id => {
      if (!path) {
        return;
      }
      const stats = await stat(path).catch(() => {});
      if (!stats || !stats.isFile()) {
        return;
      }
      return {
        type: pdf ? 'application/pdf' : 'application/octet-stream',
        size: stats.size,
        mtime: stats.mtimeMs,
      };
    },
    fallthrough: !path,
  });
}));

app.use(router);

export const handler = toWebHandler(app);

export default handler;
