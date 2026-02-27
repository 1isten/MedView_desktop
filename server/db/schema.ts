import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const parsingCache = sqliteTable('parsing', {
  key: text('key').primaryKey(), // path|size|mtime

  name: text('name').notNull(),
  path: text('path').notNull(),
  root: text('root').notNull(),
  type: text('type').notNull(),

  tags: text('tags', { mode: 'json' }).$type<{
    TransferSyntaxUID?: string;
    SOPClassUID?: string;

    // ...

    PatientName?: string;
    PatientID?: string;

    StudyInstanceUID?: string;
    StudyDescription?: string;
    StudyID?: string;
    StudyDate?: string;
    StudyTime?: string;

    SeriesInstanceUID?: string;
    SeriesDescription?: string;
    SeriesNumber?: string;

    SOPInstanceUID?: string;
    InstanceNumber?: string;
  }>(),

  isVolume: integer('is_volume', { mode: 'boolean' }).notNull().default(false),

  thumbnailDataURL: text('thumbnail_data_url'),
  thumbnailWidth: integer('thumbnail_width'),
  thumbnailHeight: integer('thumbnail_height'),
});
