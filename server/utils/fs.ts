import fsPromises from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { normalizePath } from './path';

export async function pathExists(fullPath: string) {
  try {
    await fsPromises.access(fullPath);
  } catch {
    // console.error('cannot access', fullPath);
    return false;
  }
  return fs.existsSync(fullPath);
}

export async function readDirs(fullPaths: string[] = []) {
  const folders = [];
  const files = [];
  for (const fullPath of fullPaths) {
    if (!fs.existsSync(fullPath)) {
      continue;
    }
    const filePath = normalizePath(fullPath);
    const fileName = path.basename(filePath);
    const fileStat = await fsPromises.stat(filePath).catch(() => {});
    if (
      !fileStat ||
      fileName.startsWith('.') ||
      fileName.endsWith('.lnk') ||
      fileStat.isSymbolicLink()
    ) {
      continue;
    } else if (fileStat.isDirectory()) {
      folders.push({
        name: fileName,
        path: filePath,
        isDirectory: true,
      });
    } else if (fileStat.isFile()) {
      files.push({
        name: fileName,
        path: filePath,
        type: path.extname(fileName).toLowerCase(),
        size: fileStat.size,
        mtime: fileStat.mtimeMs,
        isFile: true,
      });
    }
  }
  return [folders, files];
}
