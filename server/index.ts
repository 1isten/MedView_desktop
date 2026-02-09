import { createApp, createRouter, defineEventHandler, serveStatic, getQuery, readBody, setResponseHeader, sendStream, toWebHandler } from 'h3';
import { stat, readdir, readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { normalizePath } from './utils/path';
import { pathExists } from './utils/fs';

// @ts-ignore
import dcmjs from 'dcmjs';
import { encode } from '@msgpack/msgpack';

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
  const rootPaths = (body.rootPaths || []) as string[];
  const deep = !!body.deep;
  const stream = new ReadableStream({
    async start(controller) {

      // ...

      async function handleFile(fileName: string, filePath: string) {
        if (
          fileName.startsWith('.') ||
          fileName.endsWith('.lnk')
        ) {
          return;
        }
        const type = extname(fileName).toLowerCase();
        if (type === '' || type === '.dcm' || type === '.dicom') {
          try {
            const buffer = await readFile(filePath);
            const DicomDict = dcmjs.data.DicomMessage.readFile(buffer);
            if (DicomDict) {
              let PixelData = DicomDict.dict['7FE00010']?.Value;
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
                  const Rows = DicomDict.dict['00280010']?.Value?.[0];
                  const Columns = DicomDict.dict['00280011']?.Value?.[0];
                  if (!Rows || !Columns) {
                    PixelData = null;
                  }
                }
              }

              // TODO: maybe add more filter conditions to filter non-supported dcm files
              // ...

              if (PixelData) {
                let TransferSyntaxUID = DicomDict.meta['00020010']?.Value?.[0];
                let SOPClassUID = DicomDict.meta['00020002']?.Value?.[0];

                // ...
                
                let PatientName = DicomDict.dict['00100010']?.Value;
                if (PatientName?.__hasValueAccessors) {
                  PatientName = PatientName.toString();
                } else {
                  PatientName = PatientName?.[0];
                }
                let PatientID = DicomDict.dict['00100020']?.Value?.[0];

                let StudyInstanceUID = DicomDict.dict['0020000D']?.Value?.[0];
                let StudyDescription = DicomDict.dict['00081030']?.Value?.[0];
                let StudyID = DicomDict.dict['00200010']?.Value?.[0];

                let SeriesInstanceUID = DicomDict.dict['0020000E']?.Value?.[0];
                let SeriesDescription = DicomDict.dict['0008103E']?.Value?.[0];
                let SeriesNumber = DicomDict.dict['00200011']?.Value?.[0];

                let SOPInstanceUID = DicomDict.dict['00080018']?.Value?.[0];
                let InstanceNumber = DicomDict.dict['00200013']?.Value?.[0];

                // may collect more tags
                // ...

                controller.enqueue(encode({
                  name: fileName,
                  path: filePath,
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
                }));
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
      async function handlePaths(fullPaths: string[]) {
        for (const fullPath of fullPaths) {
          const access = await pathExists(fullPath);
          if (!access) {
            continue;
          }
          const fileStat = await stat(fullPath).catch(() => {});
          if (!fileStat || fileStat.isSymbolicLink()) {
            continue;
          }
          if (fileStat.isDirectory()) {
            const subPaths = await readdir(fullPath);
            const subFullPaths = subPaths.map(relativePath => join(fullPath, relativePath));
            await handlePaths(subFullPaths);
          } else if (fileStat.isFile()) {
            const fileName = basename(fullPath);
            const filePath = normalizePath(fullPath);
            await handleFile(fileName, filePath);
          }
        }
      };
      await handlePaths(rootPaths);
      controller.close();
    },
  });
  return sendStream(event, stream);
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
