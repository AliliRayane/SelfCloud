import { mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { unlink, statfs } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';
import { all, get, run, setting } from '../model/database.js';
import { fail } from '../middleware/security.js';

export const originals = path.join(config.data, 'originals');
export const previews = path.join(config.data, 'previews');
export const temporary = path.join(config.data, 'temporary');
for (const directory of [originals, previews, temporary]) mkdirSync(directory, { recursive: true });
export const originalPath = (id) => path.join(originals, id);
export const previewPath = (id) => path.join(previews, `${id}.webp`);
export async function diskCheck(bytes) {
  const disk = await statfs(config.data);
  if (disk.bavail * disk.bsize < bytes + 64 * 1024 ** 2) fail(507, 'Insufficient disk space');
}
export async function purgeFile(file) {
  // Remove the physical data before metadata: a failed removal remains retryable.
  for (const name of [originalPath(file.id), previewPath(file.id)]) {
    await unlink(name).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  run('DELETE FROM files WHERE id=?', file.id);
}
let cleaning = false;
export async function cleanupTrash() {
  if (cleaning) return;
  cleaning = true;
  try {
    const before = new Date(Date.now() - setting('trashDays', 30) * 86400000).toISOString();
    for (const file of all("SELECT * FROM files WHERE trashed_at<? AND state!='processing'", before)) await purgeFile(file);
  } catch (error) { console.error('Trash cleanup failed', error); }
  finally { cleaning = false; }
}
export function recoverStorage() {
  for (const file of readdirSync(temporary)) rmSync(path.join(temporary, file), { force: true, recursive: true });
  for (const id of readdirSync(originals)) if (!get('SELECT id FROM files WHERE id=?', id)) rmSync(originalPath(id), { force: true });
  for (const file of readdirSync(previews)) {
    if (!get('SELECT id FROM files WHERE id=?', file.replace(/\.webp$/, ''))) rmSync(path.join(previews, file), { force: true });
  }
  run("UPDATE files SET state='pending' WHERE state='processing'");
}
