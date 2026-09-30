import { DatabaseSync } from 'node:sqlite';
import { mkdir, cp, writeFile, access, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { config } from '../config/index.js';

if (process.env.SELFCLOUD_OFFLINE !== 'true') throw new Error('Stop SelfCloud first, then set SELFCLOUD_OFFLINE=true. See docs/backups.md.');
const destination = path.resolve(process.argv[2] || path.join('backups', new Date().toISOString().replace(/[:.]/g, '-')));
if (destination === config.data || destination.startsWith(config.data + path.sep)) throw new Error('Backup must be outside the data directory');
await access(destination).then(() => { throw new Error('Backup destination already exists'); }, () => {});
await access(path.join(config.data, 'selfcloud.sqlite'));
await mkdir(destination, { recursive: true });
const source = new DatabaseSync(path.join(config.data, 'selfcloud.sqlite'));
source.exec(`VACUUM INTO '${path.join(destination, 'selfcloud.sqlite').replaceAll("'", "''")}'`);
source.close();
await cp(path.join(config.data, 'originals'), path.join(destination, 'originals'), { recursive: true });
const hashes = {};
for (const name of ['selfcloud.sqlite', ...(await readdir(path.join(destination, 'originals'))).map(id => `originals/${id}`)]) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path.join(destination, name))) hash.update(chunk);
  hashes[name] = hash.digest('hex');
}
await writeFile(path.join(destination, 'manifest.json'), JSON.stringify({ version: 1, createdAt: new Date().toISOString(), hashes }, null, 2));
console.log(`Backup completed: ${destination}`);
