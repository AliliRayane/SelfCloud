import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir, mkdir, cp } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { config } from '../config/index.js';

if (process.env.SELFCLOUD_OFFLINE !== 'true') throw new Error('Stop SelfCloud first, then set SELFCLOUD_OFFLINE=true. See docs/backups.md.');
if (!process.argv[2]) throw new Error('Usage: npm run restore -- /path/to/backup');
const source = path.resolve(process.argv[2]);
const contents = await readdir(config.data).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
if (contents.length) throw new Error('Restore requires an empty data directory. Preserve the existing directory before proceeding.');
const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));
if (manifest.version !== 1 || !manifest.hashes?.['selfcloud.sqlite']) throw new Error('Invalid backup manifest');
for (const [name, expected] of Object.entries(manifest.hashes)) {
  if (name !== 'selfcloud.sqlite' && !/^originals\/[0-9a-f-]{36}$/.test(name)) throw new Error('Invalid backup path');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path.join(source, name))) hash.update(chunk);
  if (hash.digest('hex') !== expected) throw new Error(`Backup integrity failure: ${name}`);
}
const db = new DatabaseSync(path.join(source, 'selfcloud.sqlite'), { readOnly: true });
if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('SQLite integrity check failed');
for (const file of db.prepare('SELECT id FROM files').all()) {
  if (!manifest.hashes[`originals/${file.id}`]) throw new Error(`Missing original: ${file.id}`);
}
db.close();
await mkdir(config.data, { recursive: true });
await cp(path.join(source, 'selfcloud.sqlite'), path.join(config.data, 'selfcloud.sqlite'));
await cp(path.join(source, 'originals'), path.join(config.data, 'originals'), { recursive: true });
const restored = new DatabaseSync(path.join(config.data, 'selfcloud.sqlite'));
restored.exec("UPDATE files SET state='pending',preview_size=0,processing_error=NULL; DELETE FROM sessions;");
restored.close();
console.log('Restore completed. Start SelfCloud to regenerate previews. All sessions were invalidated.');
