import { normalize } from 'node:path';
import { normalizePath as _ } from '../../app/utils/path';

export function normalizePath(path?: string): string {
  if (path) {
    path = _(normalize(path));
  }
  return path || '';
}
