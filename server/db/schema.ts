import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const DB_CACHE_PARSING_TABLE_NAME = 'parsing';

export const parsingCache = sqliteTable(DB_CACHE_PARSING_TABLE_NAME, {
  key: text('key').primaryKey(), // path|size|mtime

  type: text('type').notNull(),
  name: text('name').notNull(),
  path: text('path').notNull(),
  root: text('root').notNull(),

  tags: text('tags', { mode: 'json' }).$type<{
    MediaStorageSOPClassUID?: string;
    MediaStorageSOPInstanceUID?: string;
    TransferSyntaxUID?: string;

    // ...

    PatientName?: string;
    PatientID?: string;

    StudyInstanceUID?: string;
    StudyDescription?: string;
    StudyID?: string;
    StudyDate?: string;
    StudyTime?: string;
    AccessionNumber?: string;

    SeriesInstanceUID?: string;
    SeriesDescription?: string;
    Modality?: string;
    SeriesNumber?: string;

    SOPInstanceUID?: string;
    SOPClassUID?: string;
    ReferencedSOPClassUIDInFile?: string;
    ReferencedSOPInstanceUIDInFile?: string;
    ReferencedTransferSyntaxUIDInFile?: string;
    InstanceNumber?: string;
  }>(),

  isVolume: integer('is_volume', { mode: 'boolean' }).notNull().default(false),

  thumbnailDataURL: text('thumbnail_data_url'),
  thumbnailWidth: integer('thumbnail_width'),
  thumbnailHeight: integer('thumbnail_height'),
}, (table => [
  uniqueIndex('path_idx').on(table.path),
  index('root_idx').on(table.root),
]));
