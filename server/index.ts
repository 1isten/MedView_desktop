import { createApp, createRouter, defineEventHandler, serveStatic, getQuery, readBody, setResponseHeader, sendStream, toWebHandler } from 'h3';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, rmSync, type Stats } from 'node:fs';
import { stat, lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, basename, extname, join, relative } from 'node:path';
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
  const generateRootDICOMDIR = !!body.DICOMDIR;

  // write DICOMDIR record
  const payloadRecordedForRootDICOMDIR = new Map<string, any[]>();
  // read DICOMDIR record
  const fileRecordedInDICOMDIR: Record<string, boolean> = Object.create(null);

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
          // read DICOMDIR(s) first
          await Promise.all(DICOMDIRs.map(async ({ fullPath, fileName, fileStat }) => {
            try {
              const buffer = await readFile(fullPath);
              const DicomDict = dcmjs.data.DicomMessage.readFile(buffer);
              const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(DicomDict.dict);
              dataset._meta = dcmjs.data.DicomMetaDictionary.namifyDataset(DicomDict.meta);
              // return controller.enqueue(encode({ type: 'DICOMDIR', dataset }));
              let currentPatient: Record<string, any> = {};
              let currentStudy: Record<string, any> = {};
              let currentSeries: Record<string, any> = {};
              let currentImage: Record<string, any> = {};
              const records = [] as {
                fileName: string;
                filePath: string;
                record: Record<string, any>;
              }[];
              const DirectoryRecordSequence = dataset.DirectoryRecordSequence || [];
              for (let s = 0; s < DirectoryRecordSequence.length; s++) {
                const seq = DirectoryRecordSequence[s];
                if (seq.DirectoryRecordType?.toUpperCase() === 'PATIENT') {
                  currentPatient = seq;
                  currentStudy = {};
                  currentSeries = {};
                  currentImage = {};
                  continue;
                }
                if (seq.DirectoryRecordType?.toUpperCase() === 'STUDY') {
                  currentStudy = seq;
                  currentSeries = {};
                  currentImage = {};
                  continue;
                }
                if (seq.DirectoryRecordType?.toUpperCase() === 'SERIES') {
                  currentSeries = seq;
                  currentImage = {};
                  continue;
                }
                if (seq.DirectoryRecordType?.toUpperCase() === 'IMAGE' && !!seq.ReferencedFileID?.length) {
                  currentImage = seq;
                } else {
                  continue;
                }
                records.push({
                  fileName: currentImage.ReferencedFileID.at(-1),
                  filePath: normalizePath(join(dirname(fullPath), ...currentImage.ReferencedFileID)),
                  record: {
                    _meta: dataset._meta,
                    PATIENT: currentPatient,
                    STUDY: currentStudy,
                    SERIES: currentSeries,
                    IMAGE: currentImage,
                  },
                });
              }
              await Promise.all(records.map(async ({ fileName, filePath, record }) => {
                const access = await pathExists(filePath);
                if (!access) {
                  // because standard DICOMDIR's ReferencedFileID typically contains file name in uppercase without extension
                  if (fileName.slice(-4).toLowerCase() !== '.dcm') {
                    fileName += '.dcm';
                    filePath += '.dcm';
                  } else {
                    fileName = fileName.slice(0, -4);
                    filePath = filePath.slice(0, -4);
                  }
                }
                let fileStat = await stat(filePath).catch(() => {});
                if (fileStat && fileStat.isFile()) {
                  await limit(() => handleFile(fileName!, filePath, fileStat!.size, fileStat!.mtimeMs, rootPath === '*' ? dirname(fullPath) : rootPath, record));
                }
              }));
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
          if (fileRecordedInDICOMDIR[filePath] && !record) {
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
                  if (record) fileRecordedInDICOMDIR[filePath] = true;
                  controller.enqueue(encode(payload));
                  return; // hit cache
                }
              }

              // ...

              let MediaStorageSOPClassUID;            // 0002,0002
              let MediaStorageSOPInstanceUID;         // 0002,0003
              let TransferSyntaxUID;                  // 0002,0010

              // ...

              let PatientName;                        // 0010,0010
              let PatientID;                          // 0010,0020

              let StudyInstanceUID;                   // 0020,000D
              let StudyDescription;                   // 0008,1030
              let StudyID;                            // 0020,0010
              let StudyDate;                          // 0008,0020
              let StudyTime;                          // 0008,0030
              let AccessionNumber;                    // 0008,0050

              let SeriesInstanceUID;                  // 0020,000E
              let SeriesDescription;                  // 0008,103E
              let Modality;                           // 0008,0060
              let SeriesNumber;                       // 0020,0011

              let SOPInstanceUID;                     // 0008,0018
              let SOPClassUID;                        // 0008,0016
              let ReferencedSOPClassUIDInFile;        // 0004,1510
              let ReferencedSOPInstanceUIDInFile;     // 0004,1511
              let ReferencedTransferSyntaxUIDInFile;  // 0004,1512
              let InstanceNumber;                     // 0020,0013

              // may collect more tags
              // ...

              // use record from DICOMDIR
              if (
                record?._meta &&
                record.PATIENT &&
                record.STUDY &&
                record.SERIES &&
                record.IMAGE
              ) {
                MediaStorageSOPClassUID = record._meta.MediaStorageSOPClassUID?.Value?.[0];
                MediaStorageSOPInstanceUID = record._meta.MediaStorageSOPInstanceUID?.Value?.[0];
                TransferSyntaxUID = record._meta.TransferSyntaxUID?.Value?.[0];

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
                AccessionNumber = record.STUDY.AccessionNumber;

                SeriesInstanceUID = record.SERIES.SeriesInstanceUID;
                SeriesDescription = record.SERIES.SeriesDescription;
                Modality = record.SERIES.Modality;
                SeriesNumber = record.SERIES.SeriesNumber;

                SOPInstanceUID = record.IMAGE.SOPInstanceUID;
                SOPClassUID = record.IMAGE.SOPClassUID;
                ReferencedSOPClassUIDInFile = record.IMAGE.ReferencedSOPClassUIDInFile;
                ReferencedSOPInstanceUIDInFile = record.IMAGE.ReferencedSOPInstanceUIDInFile;
                ReferencedTransferSyntaxUIDInFile = record.IMAGE.ReferencedTransferSyntaxUIDInFile;
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

                MediaStorageSOPClassUID = meta['00020002']?.Value?.[0];
                MediaStorageSOPInstanceUID = meta['00020003']?.Value?.[0];
                TransferSyntaxUID = meta['00020010']?.Value?.[0];

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
                AccessionNumber = dict['00080050']?.Value?.[0];

                SeriesInstanceUID = dict['0020000E']?.Value?.[0];
                SeriesDescription = dict['0008103E']?.Value?.[0];
                Modality = dict['00080060']?.Value?.[0];
                SeriesNumber = dict['00200011']?.Value?.[0];

                SOPInstanceUID = dict['00080018']?.Value?.[0];
                SOPClassUID = dict['00080016']?.Value?.[0];
                ReferencedSOPClassUIDInFile = dict['00041510']?.Value?.[0];
                ReferencedSOPInstanceUIDInFile = dict['00041511']?.Value?.[0];
                ReferencedTransferSyntaxUIDInFile = dict['00041512']?.Value?.[0];
                InstanceNumber = dict['00200013']?.Value?.[0];
              }

              const payload: any = {
                key: cacheKey,

                type: 'application/dicom',
                name: fileName,
                path: filePath,
                root: rootPath,

                tags: {
                  MediaStorageSOPClassUID,
                  MediaStorageSOPInstanceUID,
                  TransferSyntaxUID,

                  // ...

                  PatientName,
                  PatientID,

                  StudyInstanceUID,
                  StudyDescription,
                  StudyID,
                  StudyDate,
                  StudyTime,
                  AccessionNumber,

                  SeriesInstanceUID,
                  SeriesDescription,
                  Modality,
                  SeriesNumber,

                  SOPInstanceUID,
                  SOPClassUID,
                  ReferencedSOPClassUIDInFile,
                  ReferencedSOPInstanceUIDInFile,
                  ReferencedTransferSyntaxUIDInFile,
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
              ].includes(payload.tags.MediaStorageSOPClassUID);

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

              // write DICOMDIR preparation
              if (generateRootDICOMDIR && rootPath) {
                if (!payloadRecordedForRootDICOMDIR.has(rootPath)) {
                  payloadRecordedForRootDICOMDIR.set(rootPath, []);
                }
                payloadRecordedForRootDICOMDIR.get(rootPath)!.push(payload);
              }

              if (record) fileRecordedInDICOMDIR[filePath] = true;
              controller.enqueue(encode(payload));
            } catch (err) {
              console.error('cannot parse', filePath, err);
            }
          } else {
            // TODO: support more file types
            // ...
          }
        }
        // write DICOMDIR
        if (generateRootDICOMDIR) {
          for (const [rootPath, payloads] of payloadRecordedForRootDICOMDIR) {
            try {
              const DICOMDIR = await writeDICOMDIR(rootPath, payloads);
              if (DICOMDIR) {
                controller.enqueue(encode({ type: 'DICOMDIR', output: DICOMDIR }));
              }
            } catch (err) {
              console.error('cannot write DICOMDIR for', rootPath, err);
            }
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

// ---

// helper to create DICOMDIR file (written by AI)
async function writeDICOMDIR(rootPath: string, payloads: any[]) {
  if (!payloads.length) return;

  const outputDICOMDIR = join(rootPath, 'DICOMDIR');

  // Group payloads into Patient > Study > Series > Image hierarchy
  const patients = new Map<string, {
    PatientName: string;
    PatientID: string;
    studies: Map<string, {
      StudyInstanceUID: string;
      StudyDescription: string;
      StudyID: string;
      StudyDate: string;
      StudyTime: string;
      AccessionNumber: string;
      series: Map<string, {
        SeriesInstanceUID: string;
        SeriesDescription: string;
        Modality: string;
        SeriesNumber: string;
        images: {
          SOPInstanceUID: string;
          SOPClassUID: string;
          ReferencedSOPClassUIDInFile: string;
          ReferencedSOPInstanceUIDInFile: string;
          ReferencedTransferSyntaxUIDInFile: string;
          InstanceNumber: string;
          filePath: string;
        }[];
      }>;
    }>;
  }>();

  for (const p of payloads) {
    const t = p.tags || {};
    const patientKey = t.PatientID || t.PatientName || 'Anonymous';
    if (!patients.has(patientKey)) {
      patients.set(patientKey, {
        PatientName: t.PatientName || '',
        PatientID: t.PatientID || '',
        studies: new Map(),
      });
    }
    const patient = patients.get(patientKey)!;

    const studyKey = t.StudyInstanceUID || t.StudyDescription || t.StudyID || 'Unknown Study';
    if (!patient.studies.has(studyKey)) {
      patient.studies.set(studyKey, {
        StudyInstanceUID: t.StudyInstanceUID || '',
        StudyDescription: t.StudyDescription || '',
        StudyID: t.StudyID || '',
        StudyDate: t.StudyDate || '',
        StudyTime: t.StudyTime || '',
        AccessionNumber: t.AccessionNumber || '',
        series: new Map(),
      });
    }
    const study = patient.studies.get(studyKey)!;

    const seriesKey = t.SeriesInstanceUID || t.SeriesDescription || 'Unknown Series';
    if (!study.series.has(seriesKey)) {
      study.series.set(seriesKey, {
        SeriesInstanceUID: t.SeriesInstanceUID || '',
        SeriesDescription: t.SeriesDescription || '',
        Modality: t.Modality || '',
        SeriesNumber: t.SeriesNumber ? `${t.SeriesNumber}` : '',
        images: [],
      });
    }
    const series = study.series.get(seriesKey)!;

    series.images.push({
      SOPInstanceUID: t.SOPInstanceUID || '',
      SOPClassUID: t.SOPClassUID || '',
      ReferencedSOPClassUIDInFile: t.ReferencedSOPClassUIDInFile || t.SOPClassUID || '',
      ReferencedSOPInstanceUIDInFile: t.ReferencedSOPInstanceUIDInFile || t.SOPInstanceUID || '',
      ReferencedTransferSyntaxUIDInFile: t.ReferencedTransferSyntaxUIDInFile || t.TransferSyntaxUID || '',
      InstanceNumber: t.InstanceNumber ? `${t.InstanceNumber}` : '',
      filePath: normalizePath(relative(rootPath, p.path)),
    });
    series.images.sort((a, b) => (parseInt(a.InstanceNumber) || 0) - (parseInt(b.InstanceNumber) || 0));
  }

  // dcmjs.DicomDict.write() always encodes text as UTF-8, so the generated
  // DICOMDIR must declare ISO_IR 192 (UTF-8) regardless of source file charsets.
  const specificCharacterSet = 'ISO_IR 192';

  // Build the DirectoryRecordSequence as DICOM JSON (un-naturalized) records
  // Include offset placeholder tags (0004,1400 and 0004,1420) — required by the standard
  const directoryRecords: Record<string, any>[] = [];
  // Track hierarchy for offset computation
  const firstChildIdx: number[] = [];
  const nextSiblingIdx: number[] = [];
  const patientIndices: number[] = [];

  for (const [, patient] of patients) {
    const patientIdx = directoryRecords.length;
    patientIndices.push(patientIdx);

    // PATIENT record
    directoryRecords.push({
      '00041400': { vr: 'UL', Value: [0] },                                               // OffsetOfTheNextDirectoryRecord
      '00041410': { vr: 'US', Value: [0xFFFF] },                                          // RecordInUseFlag
      '00041420': { vr: 'UL', Value: [0] },                                               // OffsetOfReferencedLowerLevelDirectoryEntity
      '00041430': { vr: 'CS', Value: ['PATIENT'] },                                       // DirectoryRecordType
      '00080005': { vr: 'CS', Value: [specificCharacterSet] },                            // SpecificCharacterSet
      '00100010': { vr: 'PN', Value: [{ Alphabetic: patient.PatientName }] },             // PatientName
      '00100020': { vr: 'LO', Value: [patient.PatientID] },                               // PatientID
    });
    firstChildIdx.push(-1);
    nextSiblingIdx.push(-1);

    const studyIndices: number[] = [];

    for (const [, study] of patient.studies) {
      const studyIdx = directoryRecords.length;
      studyIndices.push(studyIdx);

      // STUDY record
      directoryRecords.push({
        '00041400': { vr: 'UL', Value: [0] },
        '00041410': { vr: 'US', Value: [0xFFFF] },
        '00041420': { vr: 'UL', Value: [0] },
        '00041430': { vr: 'CS', Value: ['STUDY'] },
        '00080005': { vr: 'CS', Value: [specificCharacterSet] },
        '0020000D': { vr: 'UI', Value: [study.StudyInstanceUID] },                        // StudyInstanceUID
        '00081030': { vr: 'LO', Value: [study.StudyDescription] },                        // StudyDescription
        '00200010': { vr: 'SH', Value: [study.StudyID] },                                 // StudyID
        '00080020': { vr: 'DA', Value: [study.StudyDate] },                               // StudyDate
        '00080030': { vr: 'TM', Value: [study.StudyTime] },                               // StudyTime
        '00080050': { vr: 'SH', Value: [study.AccessionNumber] },                         // AccessionNumber
      });
      firstChildIdx.push(-1);
      nextSiblingIdx.push(-1);

      const seriesIndices: number[] = [];

      const sortedSeries = [...study.series.values()].sort((a, b) => (parseInt(a.SeriesNumber) || 0) - (parseInt(b.SeriesNumber) || 0));
      for (const series of sortedSeries) {
        const seriesIdx = directoryRecords.length;
        seriesIndices.push(seriesIdx);

        // SERIES record
        directoryRecords.push({
          '00041400': { vr: 'UL', Value: [0] },
          '00041410': { vr: 'US', Value: [0xFFFF] },
          '00041420': { vr: 'UL', Value: [0] },
          '00041430': { vr: 'CS', Value: ['SERIES'] },
          '0020000E': { vr: 'UI', Value: [series.SeriesInstanceUID] },                    // SeriesInstanceUID
          '0008103E': { vr: 'LO', Value: [series.SeriesDescription] },                    // SeriesDescription
          '00080060': { vr: 'CS', Value: [series.Modality] },                             // Modality
          '00200011': { vr: 'IS', Value: [series.SeriesNumber] },                         // SeriesNumber
        });
        firstChildIdx.push(-1);
        nextSiblingIdx.push(-1);

        const imageIndices: number[] = [];

        for (const image of series.images) {
          const imageIdx = directoryRecords.length;
          imageIndices.push(imageIdx);

          // IMAGE record
          const fileIDParts = image.filePath.split('/');
          // if (fileIDParts[fileIDParts.length - 1].slice(-4)?.toLowerCase() === '.dcm') fileIDParts[fileIDParts.length - 1] = fileIDParts[fileIDParts.length - 1].slice(0, -4);
          directoryRecords.push({
            '00041400': { vr: 'UL', Value: [0] },
            '00041410': { vr: 'US', Value: [0xFFFF] },
            '00041420': { vr: 'UL', Value: [0] },
            '00041430': { vr: 'CS', Value: ['IMAGE'] },
            '00041500': { vr: 'CS', Value: fileIDParts },                                 // ReferencedFileID
            '00041510': { vr: 'UI', Value: [image.ReferencedSOPClassUIDInFile] },         // ReferencedSOPClassUIDInFile
            '00041511': { vr: 'UI', Value: [image.ReferencedSOPInstanceUIDInFile] },      // ReferencedSOPInstanceUIDInFile
            '00041512': { vr: 'UI', Value: [image.ReferencedTransferSyntaxUIDInFile] },   // ReferencedTransferSyntaxUIDInFile
            '00080018': { vr: 'UI', Value: [image.SOPInstanceUID] },                      // SOPInstanceUID
            '00080016': { vr: 'UI', Value: [image.SOPClassUID] },                         // SOPClassUID
            '00200013': { vr: 'IS', Value: [image.InstanceNumber] },                      // InstanceNumber
          });
          firstChildIdx.push(-1);
          nextSiblingIdx.push(-1);
        }

        // Link image siblings
        for (let i = 0; i < imageIndices.length - 1; i++) {
          nextSiblingIdx[imageIndices[i]] = imageIndices[i + 1];
        }
        // Series -> first image
        if (imageIndices.length > 0) {
          firstChildIdx[seriesIdx] = imageIndices[0];
        }
      }

      // Link series siblings
      for (let i = 0; i < seriesIndices.length - 1; i++) {
        nextSiblingIdx[seriesIndices[i]] = seriesIndices[i + 1];
      }
      // Study -> first series
      if (seriesIndices.length > 0) {
        firstChildIdx[studyIdx] = seriesIndices[0];
      }
    }

    // Link study siblings
    for (let i = 0; i < studyIndices.length - 1; i++) {
      nextSiblingIdx[studyIndices[i]] = studyIndices[i + 1];
    }
    // Patient -> first study
    if (studyIndices.length > 0) {
      firstChildIdx[patientIdx] = studyIndices[0];
    }
  }

  // Link patient siblings
  for (let i = 0; i < patientIndices.length - 1; i++) {
    nextSiblingIdx[patientIndices[i]] = patientIndices[i + 1];
  }

  // Free hierarchy memory — no longer needed after building records
  patients.clear();

  // Build the DICOM dictionary dataset
  const meta: Record<string, any> = {
    '00020001': { vr: 'OB', Value: [new Uint8Array([0x00, 0x01]).buffer] },               // FileMetaInformationVersion
    '00020002': { vr: 'UI', Value: ['1.2.840.10008.1.3.10'] },                            // MediaStorageSOPClassUID
    '00020003': { vr: 'UI', Value: [dcmjs.data.DicomMetaDictionary.uid()] },              // MediaStorageSOPInstanceUID
    '00020010': { vr: 'UI', Value: ['1.2.840.10008.1.2.1'] },                             // TransferSyntaxUID
    '00020012': { vr: 'UI', Value: ['1.2.826.0.1.3680043.8.1055.1'] },                    // ImplementationClassUID
    '00020013': { vr: 'SH', Value: ['PMTaro'] },                                          // ImplementationVersionName
  };

  const dataset: Record<string, any> = {
    '00080005': { vr: 'CS', Value: [specificCharacterSet] },
    '00041130': { vr: 'CS', Value: [''] },                                                // FileSetID
    '00041200': { vr: 'UL', Value: [0] },                                                 // OffsetOfTheFirstDirectoryRecordOfTheRootDirectoryEntity
    '00041202': { vr: 'UL', Value: [0] },                                                 // OffsetOfTheLastDirectoryRecordOfTheRootDirectoryEntity
    '00041212': { vr: 'US', Value: [0x0000] },                                            // FileSetConsistencyFlag
    '00041220': { vr: 'SQ', Value: directoryRecords },                                    // DirectoryRecordSequence
  };

  const DicomDict = new dcmjs.data.DicomDict(meta);
  DicomDict.dict = dataset;

  // Write with placeholder offsets
  const arrayBuffer = DicomDict.write({ allowInvalidVRLength: true });
  const buf = Buffer.from(arrayBuffer);

  // Single-pass structure-aware binary offset patching
  // Explicit VR Little Endian layout:
  // UL tag: group(2 LE) + element(2 LE) + "UL"(2) + length(2 LE) + value(4 LE) = 12 bytes, value at +8
  // SQ tag: group(2 LE) + element(2 LE) + "SQ"(2) + reserved(2) + length(4 LE) = 12 bytes, items at +12
  // Item: FFFE,E000 + length(4 LE) = 8 bytes

  // Locate (0004,1220) DirectoryRecordSequence in the dataset-level region
  let sqTagPos = -1;
  for (let i = 0; i <= buf.length - 12; i++) {
    if (buf[i] === 0x04 && buf[i + 1] === 0x00 && buf[i + 2] === 0x20 && buf[i + 3] === 0x12 &&
        buf[i + 4] === 0x53 && buf[i + 5] === 0x51) { // (0004,1220) SQ
      sqTagPos = i;
      break;
    }
  }
  if (sqTagPos === -1) {
    console.error('DICOMDIR offset patch: SQ tag (0004,1220) not found');
    await writeFile(outputDICOMDIR, buf);
    return;
  }
  const sqItemsStart = sqTagPos + 12; // skip tag(4) + VR(2) + reserved(2) + length(4)

  // Determine SQ end: check if length is defined or undefined (0xFFFFFFFF)
  const sqLength = buf.readUInt32LE(sqTagPos + 8);
  let sqEnd: number;
  if (sqLength !== 0xFFFFFFFF) {
    // Defined length — use it directly
    sqEnd = sqItemsStart + sqLength;
  } else {
    // Undefined length — find the last Sequence Delimitation Item (FFFE,E0DD)
    // Scanning backward avoids accidentally picking a nested SQ delimiter
    sqEnd = buf.length;
    for (let i = buf.length - 4; i >= sqItemsStart; i--) {
      if (buf[i] === 0xFE && buf[i + 1] === 0xFF && buf[i + 2] === 0xDD && buf[i + 3] === 0xE0) {
        sqEnd = i;
        break;
      }
    }
  }

  // Single pass through the SQ region: collect Item positions, (0004,1400) and (0004,1420)
  const itemPositions: number[] = [];
  const tag1400Pos: number[] = [];
  const tag1420Pos: number[] = [];
  for (let i = sqItemsStart; i <= sqEnd - 4; i++) {
    const b0 = buf[i], b1 = buf[i + 1], b2 = buf[i + 2], b3 = buf[i + 3];
    // Item tag: FFFE,E000
    if (b0 === 0xFE && b1 === 0xFF && b2 === 0x00 && b3 === 0xE0) {
      itemPositions.push(i);
      continue;
    }
    // Group 0004 UL tags with length=4
    if (b0 === 0x04 && b1 === 0x00 && i <= sqEnd - 8 &&
        buf[i + 4] === 0x55 && buf[i + 5] === 0x4C && buf[i + 6] === 0x04 && buf[i + 7] === 0x00) {
      if (b2 === 0x00 && b3 === 0x14) { tag1400Pos.push(i); continue; } // (0004,1400)
      if (b2 === 0x20 && b3 === 0x14) { tag1420Pos.push(i); continue; } // (0004,1420)
    }
  }

  if (itemPositions.length !== directoryRecords.length) {
    console.error('DICOMDIR offset patch: expected', directoryRecords.length, 'items, found', itemPositions.length);
    await writeFile(outputDICOMDIR, buf);
    return;
  }
  if (tag1400Pos.length !== directoryRecords.length || tag1420Pos.length !== directoryRecords.length) {
    console.error('DICOMDIR offset patch: offset tag count mismatch (1400:', tag1400Pos.length, '1420:', tag1420Pos.length, 'expected:', directoryRecords.length, ')');
    await writeFile(outputDICOMDIR, buf);
    return;
  }

  // Validate: each offset tag must fall within its expected item's byte range
  for (let i = 0; i < directoryRecords.length; i++) {
    const itemStart = itemPositions[i];
    const itemEnd = i + 1 < itemPositions.length ? itemPositions[i + 1] : sqEnd;
    if (tag1400Pos[i] < itemStart || tag1400Pos[i] >= itemEnd ||
        tag1420Pos[i] < itemStart || tag1420Pos[i] >= itemEnd) {
      console.error('DICOMDIR offset patch: offset tag position out of item bounds at record', i);
      await writeFile(outputDICOMDIR, buf);
      return;
    }
  }

  // Patch each record's (0004,1400) and (0004,1420) with correct byte offsets
  for (let i = 0; i < directoryRecords.length; i++) {
    const nextSibling = nextSiblingIdx[i];
    const firstChild = firstChildIdx[i];
    buf.writeUInt32LE(nextSibling >= 0 ? itemPositions[nextSibling] : 0, tag1400Pos[i] + 8);
    buf.writeUInt32LE(firstChild >= 0 ? itemPositions[firstChild] : 0, tag1420Pos[i] + 8);
  }

  // Patch root-level (0004,1200) and (0004,1202) — scan only the region before the SQ tag
  let tag1200Offset = -1;
  let tag1202Offset = -1;
  for (let i = 0; i <= sqTagPos - 8; i++) {
    if (buf[i] === 0x04 && buf[i + 1] === 0x00 &&
        buf[i + 4] === 0x55 && buf[i + 5] === 0x4C && buf[i + 6] === 0x04 && buf[i + 7] === 0x00) {
      if (buf[i + 2] === 0x00 && buf[i + 3] === 0x12) tag1200Offset = i; // (0004,1200)
      if (buf[i + 2] === 0x02 && buf[i + 3] === 0x12) tag1202Offset = i; // (0004,1202)
    }
  }
  if (tag1200Offset >= 0 && patientIndices.length > 0) {
    buf.writeUInt32LE(itemPositions[patientIndices[0]], tag1200Offset + 8);
  }
  if (tag1202Offset >= 0 && patientIndices.length > 0) {
    buf.writeUInt32LE(itemPositions[patientIndices[patientIndices.length - 1]], tag1202Offset + 8);
  }

  await writeFile(outputDICOMDIR, buf);  
  return outputDICOMDIR;
}
