import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';

export const databases = new Map<string, ReturnType<typeof drizzle>>();

export const DB_CACHE_FOLDER_NAME = '.pmtaro';
export const DB_CACHE_FILE_NAME = 'cache.db';

export async function getParsingCacheDB(rootPath: string) {
  const cacheFolder = join(rootPath, DB_CACHE_FOLDER_NAME);
  const cacheFile = join(cacheFolder, DB_CACHE_FILE_NAME);

  let db = databases.get(rootPath);
  if (db) {
    return db;
  } else if (!existsSync(cacheFolder)) {
    mkdirSync(cacheFolder, { recursive: true });
  }

  const client = createClient({ url: `file:${cacheFile}` });
  await client.execute('PRAGMA journal_mode = WAL');
  await client.execute(`
    CREATE TABLE IF NOT EXISTS parsing (
      key TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      root TEXT NOT NULL,
      tags TEXT,
      is_volume INTEGER NOT NULL DEFAULT 0,
      thumbnail_data_url TEXT,
      thumbnail_width INTEGER,
      thumbnail_height INTEGER
    )
  `);
  await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS path_idx ON parsing (path)');
  await client.execute('CREATE INDEX IF NOT EXISTS root_idx ON parsing (root)');

  db = drizzle(client, { schema });
  databases.set(rootPath, db);
  return db;
}

export function closeDB(key: string) {
  const db = databases.get(key);
  if (db) {
    databases.delete(key);
    // libsql client will be GC'd
  }
}

export function closeAllDBs() {
  databases.clear();
}
