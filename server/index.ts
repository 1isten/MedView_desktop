import { createApp, createRouter, defineEventHandler, serveStatic, getQuery, readBody, setResponseHeader, sendStream, toWebHandler } from 'h3';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, rmSync, type Stats } from 'node:fs';
import { stat, lstat, readdir, readFile } from 'node:fs/promises';
import { dirname, basename, extname, join } from 'node:path';
import { normalizePath } from './utils/path';
import { pathExists } from './utils/fs';

// @ts-ignore
import dcmjs from 'dcmjs';
import { encode } from '@msgpack/msgpack';

import { eq } from 'drizzle-orm';
import { parsingCache } from '../server/db/schema';
import { DB_CACHE_FOLDER_NAME, getParsingCacheDB, closeDB } from '../server/db';

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
  // const deep = !!body.deep;
  const useCache = typeof body.cache === 'boolean' ? body.cache : true;
  const refreshCache = useCache === false ? false : !!body.refresh;

  const filesInDICOMDIR: Record<string, boolean> = Object.create(null);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const limit = createLimiter(16);
        await handlePaths(rootPaths, '*');
        async function handlePaths(fullPaths: string[], rootPath?: string) {
          const DICOMDIRs: { fullPath: string, fileName?: string, fileStat?: Stats }[] = [];
          const files = [] as typeof DICOMDIRs;
          const folders = [] as typeof DICOMDIRs;
          // categorize into DICOMDIR(s), file(s) and folder(s)
          for (let i = 0; i < fullPaths.length; i++) {
            const fullPath = fullPaths[i];
            const access = await pathExists(fullPath);
            if (!access) {
              continue;
            }
            const fileStat = await lstat(fullPath).catch(() => {});
            if (!fileStat || fileStat.isSymbolicLink()) {
              continue;
            }
            if (rootPath === '*') {
              // refresh cache
              if (refreshCache) {
                const rootPath = fileStat.isDirectory() ? fullPath : dirname(fullPath);
                const db = await getParsingCacheDB(rootPath);
                await db.delete(parsingCache).where(eq(parsingCache.root, rootPath));
              }
            }
            if (fileStat.isFile()) {
              const fileName = basename(fullPath);
              if (
                fileName.startsWith('.') ||
                fileName.endsWith('.lnk')
              ) {
                continue;
              }
              if (fileName === 'DICOMDIR') {
                DICOMDIRs.push({ fullPath, fileName, fileStat });
              } else {
                files.push({ fullPath, fileName, fileStat });
              }
            } else if (fileStat.isDirectory()) {
              const folderName = basename(fullPath);
              if (
                folderName.startsWith('.') ||
                folderName.endsWith('.lnk')
              ) {
                continue;
              }
              folders.push({ fullPath });
            }
          }
          // handle DICOMDIR(s) first
          await Promise.all(DICOMDIRs.map(async ({ fullPath, fileName, fileStat }) => {
            try {
              const buffer = await readFile(fullPath);
              const DicomDict = dcmjs.data.DicomMessage.readFile(buffer);
              const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(DicomDict.dict);
              dataset._meta = dcmjs.data.DicomMetaDictionary.namifyDataset(DicomDict.meta);
              // return controller.enqueue(encode({ type: 'DICOMDIR', dataset }));
              const record = {
                _meta: dataset._meta,
                PATIENT: {} as Record<string, any>,
                STUDY: {} as Record<string, any>,
                SERIES: {} as Record<string, any>,
                IMAGE: {} as Record<string, any>,
              };
              const DirectoryRecordSequence = dataset.DirectoryRecordSequence || [];
              for (let s = 0; s < DirectoryRecordSequence.length; s++) {
                const seq = DirectoryRecordSequence[s];
                if (seq.DirectoryRecordType?.toUpperCase() === 'PATIENT') {
                  record.PATIENT = seq;
                  record.STUDY = {};
                  record.SERIES = {};
                  record.IMAGE = {};
                  continue;
                }
                if (seq.DirectoryRecordType?.toUpperCase() === 'STUDY') {
                  record.STUDY = seq;
                  record.SERIES = {};
                  record.IMAGE = {};
                  continue;
                }
                if (seq.DirectoryRecordType?.toUpperCase() === 'SERIES') {
                  record.SERIES = seq;
                  record.IMAGE = {};
                  continue;
                }
                if (seq.DirectoryRecordType?.toUpperCase() === 'IMAGE' && !!seq.ReferencedFileID?.length) {
                  record.IMAGE = seq;
                } else {
                  continue;
                }
                let fileName = seq.ReferencedFileID.at(-1);
                let filePath = normalizePath(join(dirname(fullPath), ...seq.ReferencedFileID));
                if (!existsSync(filePath)) {
                  if (fileName.slice(fileName.length - 4).toLowerCase() === '.dcm') {
                    fileName = fileName.slice(0, -4);
                    filePath = filePath.slice(0, -4);
                  } else {
                    fileName += '.dcm';
                    filePath += '.dcm';
                  }
                }
                let fileStat = await stat(filePath).catch(() => {});
                if (fileStat && fileStat.isFile()) {
                  filesInDICOMDIR[filePath] = true;
                  await limit(() => handleFile(fileName!, filePath, fileStat!.size, fileStat!.mtimeMs, rootPath === '*' ? dirname(fullPath) : rootPath, record));
                }
              }
            } catch (err) {
              console.error('cannot parse DICOMDIR', fullPath, err);
            }
          }));
          // handle file(s) next
          await Promise.all(files.map(async ({ fullPath, fileName, fileStat }) => {
            const filePath = normalizePath(fullPath);
            await limit(() => handleFile(fileName!, filePath, fileStat!.size, fileStat!.mtimeMs, rootPath === '*' ? dirname(fullPath) : rootPath));
          }));
          // handle folder(s) last (deep recursion)
          await Promise.all(folders.map(async ({ fullPath }) => {
            const subPaths = await readdir(fullPath);
            const subFullPaths = subPaths.map(relativePath => join(fullPath, relativePath));
            await handlePaths(subFullPaths, rootPath === '*' ? fullPath : rootPath);
          }));
        }
        async function handleFile(fileName: string, filePath: string, fileSize: number, fileMtimeMs: number, rootPath?: string, record?: Record<string, any>) {
          if (
            fileName.startsWith('.') ||
            fileName.endsWith('.lnk')
          ) {
            return;
          }
          if (filesInDICOMDIR[filePath] && !record) {
            return; // already handled in DICOMDIR
          }
          const type = extname(fileName).toLowerCase();
          if (
            // type === '.dicom' ||
            type === '.dcm' ||
            type === ''
          ) {
            try {
              const cacheKey = !useCache ? undefined : createHash('md5')
                .update(`${filePath.slice((rootPath || '').length)}|${fileSize}|${fileMtimeMs}`) // path|size|mtime
                .digest('hex');

              // read cache
              if (useCache && rootPath) {
                const db = await getParsingCacheDB(rootPath);
                const cache = await db.select().from(parsingCache).where(eq(parsingCache.key, cacheKey!)).get();
                if (cache) {
                  const payload = {
                    ...cache,
                  };
                  controller.enqueue(encode(payload));
                  return; // hit cache
                }
              }

              // ...

              let TransferSyntaxUID;
              let SOPClassUID;

              // ...

              let PatientName;
              let PatientID;

              let StudyInstanceUID;
              let StudyDescription;
              let StudyID;
              let StudyDate;
              let StudyTime;

              let SeriesInstanceUID;
              let SeriesDescription;
              let SeriesNumber;

              let SOPInstanceUID;
              let InstanceNumber;

              // may collect more tags
              // ...

              if (
                record?._meta &&
                record.PATIENT &&
                record.STUDY &&
                record.SERIES &&
                record.IMAGE
              ) {
                TransferSyntaxUID = record._meta.TransferSyntaxUID;
                SOPClassUID = record.IMAGE.SOPClassUID;

                // ...

                PatientName = record.PATIENT.PatientName;
                if (PatientName?.__hasValueAccessors) {
                  PatientName = PatientName.toString();
                } else {
                  PatientName = PatientName?.[0] ?? PatientName;
                }
                if (PatientName && typeof PatientName === 'object') {
                  // AsyncDicomReader returns PN as DICOM JSON: { Alphabetic, Ideographic, Phonetic }
                  PatientName = PatientName.Alphabetic ?? PatientName.Ideographic ?? PatientName.Phonetic ?? '';
                }
                PatientID = record.PATIENT.PatientID;

                StudyInstanceUID = record.STUDY.StudyInstanceUID;
                StudyDescription = record.STUDY.StudyDescription;
                StudyID = record.STUDY.StudyID;
                StudyDate = record.STUDY.StudyDate;
                StudyTime = record.STUDY.StudyTime;

                SeriesInstanceUID = record.SERIES.SeriesInstanceUID;
                SeriesDescription = record.SERIES.SeriesDescription;
                SeriesNumber = record.SERIES.SeriesNumber;

                SOPInstanceUID = record.IMAGE.SOPInstanceUID;
                InstanceNumber = record.IMAGE.InstanceNumber;
              } else {
                // stream the file through AsyncDicomReader — no full buffer in memory
                const reader = new dcmjs.async.AsyncDicomReader();
                reader.stream.fromAsyncStream(createReadStream(filePath));
                await reader.readFile();
                const meta = reader.meta || {};
                const dict = reader.dict || {};
                
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
                if (PixelData) {
                  dict['7FE00010'] = null; // release memory asap
                } else {
                  return;
                }

                // TODO: maybe add more filter conditions to filter non-supported dcm files
                // ...

                TransferSyntaxUID = meta['00020010']?.Value?.[0];
                SOPClassUID = meta['00020002']?.Value?.[0];

                // ...

                PatientName = dict['00100010']?.Value;
                if (PatientName?.__hasValueAccessors) {
                  PatientName = PatientName.toString();
                } else {
                  PatientName = PatientName?.[0] ?? PatientName;
                }
                if (PatientName && typeof PatientName === 'object') {
                  // AsyncDicomReader returns PN as DICOM JSON: { Alphabetic, Ideographic, Phonetic }
                  PatientName = PatientName.Alphabetic ?? PatientName.Ideographic ?? PatientName.Phonetic ?? '';
                }
                PatientID = dict['00100020']?.Value?.[0];

                StudyInstanceUID = dict['0020000D']?.Value?.[0];
                StudyDescription = dict['00081030']?.Value?.[0];
                StudyID = dict['00200010']?.Value?.[0];
                StudyDate = dict['00080020']?.Value?.[0];
                StudyTime = dict['00080030']?.Value?.[0];

                SeriesInstanceUID = dict['0020000E']?.Value?.[0];
                SeriesDescription = dict['0008103E']?.Value?.[0];
                SeriesNumber = dict['00200011']?.Value?.[0];

                SOPInstanceUID = dict['00080018']?.Value?.[0];
                InstanceNumber = dict['00200013']?.Value?.[0];
              }

              const payload: any = {
                key: cacheKey,

                type: 'application/dicom',
                name: fileName,
                path: filePath,
                root: rootPath,

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
              };
              // Subset of those listed at:
              // http://dicom.nema.org/medical/dicom/current/output/html/part04.html#sect_B.5
              payload.isVolume = [
                '1.2.840.10008.5.1.4.1.1.2.1', // Enhanced CT Image Storage
                '1.2.840.10008.5.1.4.1.1.4.1', // Enhanced MR Image Storage
                '1.2.840.10008.5.1.4.1.1.4.3', // Enhanced MR Color Image
                '1.2.840.10008.5.1.4.1.1.6.2', // Enhanced US Volume
                '1.2.840.10008.5.1.4.1.1.12.1.1', // Enhanced XA Image Storage
                '1.2.840.10008.5.1.4.1.1.12.2.1', // Enhanced XRF Image Storage
                '1.2.840.10008.5.1.4.1.1.88.22', // Enhanced SR
                '1.2.840.10008.5.1.4.1.1.130', // EnhancedPETImage
                // ...
              ].includes(payload.tags.SOPClassUID);

              // write cache
              if (useCache && rootPath) {
                const db = await getParsingCacheDB(rootPath);
                const cache = await db.select().from(parsingCache).where(eq(parsingCache.path, payload.path)).get();
                // remove outdated cache
                if (cache && cache.key !== payload.key) {
                  await db.delete(parsingCache).where(eq(parsingCache.path, cache.path));
                }
                await db.insert(parsingCache).values({ ...payload }).onConflictDoUpdate({
                  target: parsingCache.key,
                  set: {
                    type: payload.type,
                    name: payload.name,
                    path: payload.path,
                    root: payload.root,
                    tags: payload.tags,
                    isVolume: payload.isVolume,
                  },
                });
              }

              controller.enqueue(encode(payload));
            } catch (err) {
              console.error('cannot parse', filePath, err);
            }
          } else {
            // TODO: support more file types
            // ...
          }
        }
      } catch (err) {
        controller.error(err);
      } finally {
        controller.close();
      }
    },
  });
  return sendStream(event, stream);
}));

router.get('/api/parsing/cache/thumbnail', defineEventHandler(async event => {
  const cacheKey = `${getQuery(event).cacheKey ?? getQuery(event).cache ?? getQuery(event).key ?? ''}`;
  let rootPath = `${getQuery(event).rootPath ?? getQuery(event).root ?? ''}`;
  if (rootPath) rootPath = decodeURIComponent(rootPath);
  if (cacheKey && rootPath) {
    const db = await getParsingCacheDB(rootPath);
    const cache = await db.select().from(parsingCache).where(eq(parsingCache.key, cacheKey)).get();
    if (cache && cache.thumbnailDataURL) {
      const {
        thumbnailDataURL,
        thumbnailWidth,
        thumbnailHeight,
        // ...payload
      } = cache;
      return {
        // ...payload,
        thumbnail: {
          dataURL: thumbnailDataURL,
          width: thumbnailWidth,
          height: thumbnailHeight,
        },
      };
    }
  }
  return { thumbnail: null };
}));
router.patch('/api/parsing/cache/thumbnail', defineEventHandler(async event => {
  const body = await readBody(event);
  const rootPath = body.rootPath as string;
  const cacheKey = body.cacheKey as string;
  const dataURL = body.dataURL as string;
  const width = body.width as number;
  const height = body.height as number;
  if (rootPath && cacheKey && dataURL && width && height) {
    const db = await getParsingCacheDB(rootPath);
    const patched = await db.update(parsingCache).set({
      thumbnailDataURL: dataURL,
      thumbnailWidth: width,
      thumbnailHeight: height,
    }).where(eq(parsingCache.key, cacheKey)).returning();
    if (patched.length > 0) {
      const {
        thumbnailDataURL,
        thumbnailWidth,
        thumbnailHeight,
        // ...payload
      } = patched[0];
      return {
        // ...payload,
        thumbnail: {
          dataURL: thumbnailDataURL,
          width: thumbnailWidth,
          height: thumbnailHeight,
        },
      };
    }
  }
  return { thumbnail: null };
}));

router.delete('/api/parsing/cache/clear', defineEventHandler(async event => {
  const body = await readBody(event);
  const rootPaths = (body.rootPaths || []) as string[];
  return Promise.all(rootPaths.map(async (fullPath: string) => {
    if (fullPath && existsSync(fullPath)) {
      const fileStat = await stat(fullPath);
      const rootPath = fileStat.isDirectory() ? fullPath : dirname(fullPath);
      const cacheFolder = join(rootPath, DB_CACHE_FOLDER_NAME);
      if (cacheFolder && existsSync(cacheFolder)) {
        closeDB(dirname(cacheFolder));
        rmSync(cacheFolder, { recursive: true, force: true });
        return { root: fullPath, cache: 0 };
      }
    }
    return { root: fullPath, cache: 1 };
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
