import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import sharp from 'sharp';

const execute = promisify(execFile);
const workspace = await mkdtemp(path.resolve('tests/.runtime-'));
process.env.DATA_DIR = path.join(workspace, 'data');
process.env.SETUP_TOKEN = 'test-only-setup-credential';
process.env.PUBLIC_ORIGIN = 'http://selfcloud.test';
const { app } = await import('../server.js');
const { db, get, run } = await import('../model/database.js');
const { processNextPhoto } = await import('../service/photos.js');
const { cleanupTrash, originalPath } = await import('../service/storage.js');
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}/api`;
const cookies = {};
async function request(route, { user, method = 'GET', body, origin, raw = false } = {}) {
  const response = await fetch(base + route, {
    method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookies[user] ? { Cookie: cookies[user] } : {}), ...(origin ? { Origin: origin } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: raw ? Buffer.from(await response.arrayBuffer()) : await response.json(), response };
}
async function login(username) {
  const result = await request('/login', { method: 'POST', body: { username, password: 'correct horse battery staple' } });
  assert.equal(result.status, 200);
  cookies[username] = result.response.headers.get('set-cookie').split(';')[0];
  return result.body;
}
async function upload(user, name, contents, extra = {}) {
  const data = new FormData();
  data.append('name', name);
  for (const [key, value] of Object.entries(extra)) data.append(key, value);
  data.append('file', new Blob([contents], { type: name.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream' }), name);
  const response = await fetch(base + '/files', { method: 'POST', headers: { Cookie: cookies[user] }, body: data });
  return { status: response.status, body: await response.json() };
}

test('SelfCloud end-to-end ownership, photo and recovery workflows', async t => {
  let admin, alice, bob, group, photo, document, nested;
  const jpeg = await sharp({ create: { width: 48, height: 32, channels: 3, background: '#087f8c' } }).jpeg().withExif({ IFD0: { Make: 'SelfCloud test', Model: 'Fixture' }, IFD2: { DateTimeOriginal: '2025:06:12 10:30:00' } }).toBuffer();
  try {
    await t.test('setup is token-protected and closes after initialization', async () => {
      assert.equal((await request('/status')).body.initialized, false);
      const setup = { username: 'admin', password: 'correct horse battery staple', defaultQuota: 1024 ** 2, maxUpload: 1024 ** 2, trashDays: 30, language: 'fr' };
      assert.equal((await request('/setup', { method: 'POST', body: setup })).status, 403);
      assert.equal((await request('/setup', { method: 'POST', body: { ...setup, token: process.env.SETUP_TOKEN } })).status, 201);
      assert.equal((await request('/setup', { method: 'POST', body: { ...setup, token: process.env.SETUP_TOKEN } })).status, 409);
      admin = await login('admin');
      assert.equal((await request('/status')).body.language, 'fr');
    });
    await t.test('accounts require admin and reject cross-origin writes', async () => {
      assert.equal((await request('/admin/users')).status, 401);
      assert.equal((await request('/admin/users', { user: 'admin', method: 'POST', origin: 'https://attacker.test', body: {} })).status, 403);
      for (const username of ['alice', 'bob']) {
        const result = await request('/admin/users', { user: 'admin', method: 'POST', body: { username, password: 'correct horse battery staple', quota: 1024 ** 2 } });
        assert.equal(result.status, 201);
      }
      alice = await login('alice'); bob = await login('bob');
      assert.equal((await request('/admin/users', { user: 'alice' })).status, 403);
      assert.equal((await request('/admin/users', { user: 'admin', method: 'POST', body: { username: 'Alice', password: 'correct horse battery staple' } })).status, 409);
    });
    await t.test('uploads preserve originals and enforce ownership on every route', async () => {
      const p = await upload('alice', 'holiday.jpg', jpeg);
      assert.equal(p.status, 201); photo = p.body.id;
      const d = await upload('alice', 'notes.txt', Buffer.from('private notes'));
      assert.equal(d.status, 201); document = d.body.id;
      assert.deepEqual(await readFile(originalPath(photo)), jpeg);
      for (const user of ['bob','admin']) {
        for (const suffix of ['', '/download', '/preview']) assert.equal((await request(`/files/${photo}${suffix}`, { user, raw: suffix !== '' })).status, 404);
        assert.equal((await request(`/files/${photo}/trash`, { user, method: 'POST' })).status, 404);
      }
      assert.equal((await request('/files', { user: 'bob' })).body.files.length, 0);
      assert.equal((await upload('alice', '../escape.jpg', jpeg)).status, 400);
    });
    await t.test('folder uploads preserve paths and forbid cycles', async () => {
      const result = await upload('alice', 'nested.txt', Buffer.from('nested'), { relativePath: 'family/trip/nested.txt' });
      assert.equal(result.status, 201); nested = result.body.id;
      const folders = (await request('/folders', { user: 'alice' })).body;
      const parent = folders.find(f => f.name === 'family');
      const child = folders.find(f => f.name === 'trip');
      assert.equal(child.parent_id, parent.id);
      assert.equal((await request(`/files/${nested}`, { user: 'alice' })).body.folder_id, child.id);
      assert.equal((await request(`/folders/${parent.id}`, { user: 'alice', method: 'PATCH', body: { parent: child.id } })).status, 400);
      assert.equal((await request(`/folders/${child.id}`, { user: 'alice', method: 'DELETE' })).status, 409);
      assert.equal((await request(`/files/${document}`, { user: 'bob', method: 'PATCH', body: { folder: child.id } })).status, 404);
    });
    await t.test('photo worker retains EXIF, hashes and generates protected previews', async () => {
      while (await processNextPhoto()) {}
      const details = (await request(`/files/${photo}`, { user: 'alice' })).body;
      assert.equal(details.state, 'ready');
      assert.equal(details.width, 48); assert.equal(details.height, 32);
      assert.equal(details.hash.length, 64);
      assert.equal(details.metadata.extractionVersion, 1);
      assert.ok(JSON.stringify(details.metadata).includes('SelfCloud test'));
      assert.ok(details.captured_at?.startsWith('2025-06-12'));
      const preview = await request(`/files/${photo}/preview`, { user: 'alice', raw: true });
      assert.equal(preview.status, 200);
      assert.equal((await sharp(preview.body).metadata()).format, 'webp');
      const download = await request(`/files/${photo}/download`, { user: 'alice', raw: true });
      assert.deepEqual(download.body, jpeg);
      assert.equal((await request('/files?photos=true', { user: 'alice' })).body.files.length, 1);
    });
    await t.test('groups authorize shares and isolate originals', async () => {
      const created = await request('/admin/groups', { user: 'admin', method: 'POST', body: { name: 'myfamily' } });
      assert.equal(created.status, 201); group = created.body.id;
      assert.equal((await request(`/admin/groups/${group}/members`, { user: 'admin', method: 'PUT', body: { members: [alice.id, bob.id] } })).status, 200);
      assert.equal((await request(`/groups/${group}/files/${photo}`, { user: 'bob', method: 'PUT' })).status, 404);
      assert.equal((await request(`/groups/${group}/files/${photo}`, { user: 'alice', method: 'PUT' })).status, 200);
      assert.equal((await request(`/files/${photo}/preview`, { user: 'bob', raw: true })).status, 200);
      assert.equal((await request(`/files/${photo}`, { user: 'admin' })).status, 404);
      assert.equal((await request(`/groups/${group}/files/${photo}`, { user: 'bob', method: 'DELETE' })).status, 403);
      assert.equal((await request(`/files?group=${group}&photos=true`, { user: 'bob' })).body.files.length, 1);
      assert.equal((await request(`/groups/${group}/files/${document}`, { user: 'alice', method: 'PUT' })).status, 400);
    });
    await t.test('trash hides group photos, restores shares, and counts toward quota', async () => {
      const before = (await request('/me', { user: 'alice' })).body.used;
      assert.equal((await request(`/files/${photo}/trash`, { user: 'alice', method: 'POST' })).status, 200);
      assert.equal((await request(`/files/${photo}/download`, { user: 'bob', raw: true })).status, 404);
      assert.equal((await request(`/files?group=${group}`, { user: 'bob' })).body.files.length, 0);
      assert.equal((await request('/me', { user: 'alice' })).body.used, before);
      assert.equal((await request('/files?trash=true', { user: 'alice' })).body.files.length, 1);
      assert.equal((await request(`/files/${photo}/restore`, { user: 'alice', method: 'POST' })).status, 200);
      assert.equal((await request(`/files/${photo}/download`, { user: 'bob', raw: true })).status, 200);
      assert.equal((await request(`/files/${photo}`, { user: 'alice', method: 'DELETE' })).status, 400);
    });
    await t.test('membership removal revokes access and administrators can moderate shares', async () => {
      await request(`/admin/groups/${group}/members`, { user: 'admin', method: 'PUT', body: { members: [alice.id] } });
      assert.equal((await request(`/files/${photo}`, { user: 'bob' })).status, 404);
      await request(`/admin/groups/${group}/members`, { user: 'admin', method: 'PUT', body: { members: [alice.id, bob.id] } });
      assert.equal((await request(`/groups/${group}/files/${photo}`, { user: 'admin', method: 'DELETE' })).status, 200);
      assert.equal((await request(`/files/${photo}`, { user: 'bob' })).status, 404);
      await request(`/groups/${group}/files/${photo}`, { user: 'alice', method: 'PUT' });
      await request(`/admin/groups/${group}/members`, { user: 'admin', method: 'PUT', body: { members: [bob.id] } });
      assert.equal((await request(`/files/${photo}`, { user: 'bob' })).status, 404);
    });
    await t.test('quota and request size failures do not retain uploads', async () => {
      await request(`/admin/users/${bob.id}`, { user: 'admin', method: 'PATCH', body: { quota: 10 } });
      assert.equal((await upload('bob', 'large.txt', Buffer.alloc(1024))).status, 413);
      assert.equal((await upload('alice', 'huge.txt', Buffer.alloc(2 * 1024 ** 2))).status, 413);
      assert.equal((await request('/files', { user: 'bob' })).body.files.length, 0);
      assert.equal((await upload('alice', 'broken.heic', Buffer.from('not an image'))).status, 201);
      while (await processNextPhoto()) {}
      assert.equal(get("SELECT state FROM files WHERE name='broken.heic'").state, 'unsupported');
    });
    await t.test('retention purges originals and disabled accounts lose sessions', async () => {
      await request(`/files/${document}/trash`, { user: 'alice', method: 'POST' });
      run('UPDATE files SET trashed_at=? WHERE id=?', '2000-01-01T00:00:00.000Z', document);
      await cleanupTrash();
      assert.equal(get('SELECT id FROM files WHERE id=?', document), undefined);
      await assert.rejects(readFile(originalPath(document)), { code: 'ENOENT' });
      await request(`/admin/users/${bob.id}`, { user: 'admin', method: 'PATCH', body: { disabled: true } });
      assert.equal((await request('/me', { user: 'bob' })).status, 401);
      assert.equal((await request('/login', { method: 'POST', body: { username: 'bob', password: 'correct horse battery staple' } })).status, 401);
      assert.equal((await request(`/admin/users/${admin.id}`, { user: 'admin', method: 'PATCH', body: { disabled: true } })).status, 400);
      assert.equal((await request(`/admin/users/${alice.id}`, { user: 'admin', method: 'PATCH', body: { disabled: 'false' } })).status, 400);
    });
    await t.test('password changes and administrator resets invalidate existing sessions', async () => {
      assert.equal((await request('/password', { user: 'alice', method: 'POST', body: { currentPassword: 'wrong password', password: 'a different secure password' } })).status, 403);
      assert.equal((await request('/password', { user: 'alice', method: 'POST', body: { currentPassword: 'correct horse battery staple', password: 'a different secure password' } })).status, 200);
      assert.equal((await request('/me', { user: 'alice' })).status, 401);
      const result = await request('/login', { method: 'POST', body: { username: 'alice', password: 'a different secure password' } });
      assert.equal(result.status, 200);
      cookies.alice = result.response.headers.get('set-cookie').split(';')[0];
      assert.equal((await request('/me', { user: 'alice' })).status, 200);
      assert.equal((await request(`/admin/users/${alice.id}`, { user: 'admin', method: 'PATCH', body: { password: 'correct horse battery staple' } })).status, 200);
      assert.equal((await request('/me', { user: 'alice' })).status, 401);
    });
    await t.test('backup and restore validate data and regenerate previews', async () => {
      await new Promise(resolve => server.close(resolve));
      const backup = path.join(workspace, 'backup');
      const restored = path.join(workspace, 'restored');
      await execute(process.execPath, ['scripts/backup.js', backup], { env: { ...process.env, SELFCLOUD_OFFLINE: 'true' } });
      await execute(process.execPath, ['scripts/restore.js', backup], { env: { ...process.env, SELFCLOUD_OFFLINE: 'true', DATA_DIR: restored } });
      assert.deepEqual(await readFile(path.join(restored, 'originals', photo)), jpeg);
      const { DatabaseSync } = await import('node:sqlite');
      const restoredDb = new DatabaseSync(path.join(restored, 'selfcloud.sqlite'));
      assert.equal(restoredDb.prepare('SELECT state FROM files WHERE id=?').get(photo).state, 'pending');
      assert.equal(restoredDb.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
      restoredDb.close();
      await assert.rejects(execute(process.execPath, ['scripts/restore.js', backup], { env: { ...process.env, SELFCLOUD_OFFLINE: 'true', DATA_DIR: restored } }));
      await writeFile(path.join(backup, 'originals', photo), 'corrupted backup');
      await assert.rejects(execute(process.execPath, ['scripts/restore.js', backup], { env: { ...process.env, SELFCLOUD_OFFLINE: 'true', DATA_DIR: path.join(workspace, 'corrupt-restore') } }), error => error.stderr.includes('Backup integrity failure'));
    });
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    db.close();
    await rm(workspace, { recursive: true, force: true });
  }
});
