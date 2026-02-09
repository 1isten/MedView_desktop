export function normalizePath(path: string) {
  return (path || '').trim().replace(/\\+/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
}

export async function getPathForFile(file: File) {
  if ('$electron' in window) {
    // @ts-ignore window.$electron
    return normalizePath($electron.getPathForFile(file));
  }
  return '';
}
