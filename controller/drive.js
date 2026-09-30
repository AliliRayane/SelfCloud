import multer from 'multer';
import { randomUUID, createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { all, get, run, setting, transaction } from '../model/database.js';
import { userById, usage } from '../model/user.js';
import { ownedFile, accessibleFile, ownedFolder, fileList } from '../model/file.js';
import { fail, text } from '../middleware/security.js';
import { temporary, originalPath, previewPath, diskCheck, purgeFile } from '../service/storage.js';

const photoExtension = /\.(jpe?g|png|webp|gif|avif|heic|heif|tiff?|dng|cr2|cr3|nef|arw|raf|rw2|orf)$/i;
function filename(value) {
  const name = text(value, 'filename');
  if (/[\\/]/.test(name) || name === '.' || name === '..') fail(400, 'Invalid filename');
  return name;
}
function destinationFolder(user, base, relative) {
  let parent = base || null;
  ownedFolder(parent, user);
  if (!relative) return parent;
  const parts = relative.split('/');
  if (parts.length > 50) fail(400, 'Folder nesting limit exceeded');
  parts.pop();
  for (const part of parts) {
    const name = filename(part);
    const existing = get('SELECT id FROM folders WHERE owner_id=? AND parent_id IS ? AND name=?', user.id, parent, name);
    if (existing) parent = existing.id;
    else {
      const id = randomUUID();
      run('INSERT INTO folders(id,owner_id,parent_id,name) VALUES(?,?,?,?)', id, user.id, parent, name);
      parent = id;
    }
  }
  return parent;
}
// Reserve the entire permitted request before streaming, bounding concurrent disk use.
const reservations = new Map();
export async function upload(req, res, next) {
  const max = setting('maxUpload', 2 * 1024 ** 3);
  const contentLength = Number(req.get('content-length'));
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) return next(Object.assign(new Error('A Content-Length header is required'), { status: 411 }));
  if (contentLength > max + 128 * 1024) return next(Object.assign(new Error('Upload exceeds the configured limit'), { status: 413 }));
  const reserve = Math.min(max, contentLength);
  const reserved = reservations.get(req.user.id) || 0;
  if (usage(req.user.id) + reserved + Math.max(0, reserve - 128 * 1024) > userById(req.user.id).quota) return next(Object.assign(new Error('Storage quota exceeded'), { status: 413 }));
  const totalReserved = [...reservations.values()].reduce((sum, value) => sum + value, 0);
  reservations.set(req.user.id, reserved + reserve);
  const release = () => reservations.set(req.user.id, Math.max(0, (reservations.get(req.user.id) || 0) - reserve));
  try { await diskCheck(totalReserved + reserve); }
  catch (error) { release(); return next(error); }
  const receive = multer({ dest: temporary, limits: { fileSize: max, files: 1, fields: 3, fieldSize: 16384 } }).single('file');
  receive(req, res, async (error) => {
    let moved = false;
    let id;
    try {
      if (error) throw error;
      if (!req.file) fail(400, 'No file provided');
      const name = filename(req.body.name || req.file.originalname);
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(req.file.path)) hash.update(chunk);
      id = randomUUID();
      await rename(req.file.path, originalPath(id));
      moved = true;
      transaction(() => {
        const currentUser = userById(req.user.id);
        if (currentUser.disabled) fail(403, 'Account disabled');
        if (usage(req.user.id) + req.file.size > currentUser.quota) fail(413, 'Storage quota exceeded');
        const folder = destinationFolder(req.user, req.body.folder, req.body.relativePath);
        run(`INSERT INTO files(id,owner_id,folder_id,name,mime,size,hash,uploaded_at,is_photo)
          VALUES(?,?,?,?,?,?,?,?,?)`, id, req.user.id, folder, name, req.file.mimetype, req.file.size,
          hash.digest('hex'), new Date().toISOString(), Number(photoExtension.test(name)));
      });
      res.status(201).json({ id, name });
    } catch (err) {
      if (req.file) await unlink(moved ? originalPath(id) : req.file.path).catch(() => {});
      next(err);
    } finally { release(); }
  });
}
export function list(req, res) {
  const offset = Number(req.query.offset || 0);
  if (!Number.isSafeInteger(offset) || offset < 0) fail(400, 'Invalid offset');
  const files = fileList(req.user, { folder: req.query.folder, trash: req.query.trash === 'true', photos: req.query.photos === 'true', group: req.query.group, offset });
  const folders = !req.query.group && req.query.trash !== 'true' && req.query.photos !== 'true'
    ? all('SELECT * FROM folders WHERE owner_id=? AND parent_id IS ? ORDER BY name', req.user.id, req.query.folder || null) : [];
  res.json({ files: files.slice(0, 200), folders, hasMore: files.length > 200 });
}
export function details(req, res) {
  const file = accessibleFile(req.params.id, req.user);
  res.json({ ...file, metadata: JSON.parse(file.metadata), shares: file.owner_id === req.user.id ? all('SELECT group_id FROM shares WHERE file_id=?', file.id).map(s => s.group_id) : undefined });
}
export function download(req, res) {
  const file = accessibleFile(req.params.id, req.user);
  res.set('Cache-Control', 'private, no-store');
  res.download(originalPath(file.id), file.name);
}
export function preview(req, res) {
  const file = accessibleFile(req.params.id, req.user);
  if (!file.preview_size) fail(404, 'Preview unavailable');
  res.set('Cache-Control', 'private, no-store');
  res.type('webp').sendFile(previewPath(file.id));
}
export function update(req, res) {
  const file = ownedFile(req.params.id, req.user);
  const name = req.body.name === undefined ? file.name : filename(req.body.name);
  const folder = req.body.folder === undefined ? file.folder_id : (req.body.folder || null);
  ownedFolder(folder, req.user);
  run('UPDATE files SET name=?,folder_id=? WHERE id=?', name, folder, file.id);
  res.json({ ok: true });
}
export function trash(req, res) {
  const file = ownedFile(req.params.id, req.user);
  run('UPDATE files SET trashed_at=? WHERE id=?', new Date().toISOString(), file.id);
  res.json({ ok: true });
}
export function restore(req, res) {
  const file = ownedFile(req.params.id, req.user);
  run('UPDATE files SET trashed_at=NULL WHERE id=?', file.id);
  res.json({ ok: true });
}
export async function remove(req, res) {
  const file = ownedFile(req.params.id, req.user);
  if (!file.trashed_at) fail(400, 'Move the file to trash first');
  if (file.state === 'processing') fail(409, 'Photo is processing; try again shortly');
  await purgeFile(file);
  res.json({ ok: true });
}
export function folderTree(req, res) {
  res.json(all('SELECT * FROM folders WHERE owner_id=? ORDER BY name', req.user.id));
}
export function addFolder(req, res) {
  const name = filename(req.body.name);
  const parent = req.body.parent || null;
  ownedFolder(parent, req.user);
  if (get('SELECT id FROM folders WHERE owner_id=? AND parent_id IS ? AND name=?', req.user.id, parent, name)) fail(409, 'Folder already exists');
  const id = randomUUID();
  run('INSERT INTO folders(id,owner_id,parent_id,name) VALUES(?,?,?,?)', id, req.user.id, parent, name);
  res.status(201).json({ id, name });
}
export function updateFolder(req, res) {
  const folder = ownedFolder(req.params.id, req.user);
  const name = req.body.name === undefined ? folder.name : filename(req.body.name);
  const parent = req.body.parent === undefined ? folder.parent_id : req.body.parent || null;
  ownedFolder(parent, req.user);
  let ancestor = parent;
  while (ancestor) {
    if (ancestor === folder.id) fail(400, 'Cannot move a folder into itself');
    ancestor = ownedFolder(ancestor, req.user).parent_id;
  }
  if (get('SELECT id FROM folders WHERE owner_id=? AND parent_id IS ? AND name=? AND id!=?', req.user.id, parent, name, folder.id)) fail(409, 'Folder already exists');
  run('UPDATE folders SET name=?,parent_id=? WHERE id=?', name, parent, folder.id);
  res.json({ ok: true });
}
export function removeFolder(req, res) {
  const folder = ownedFolder(req.params.id, req.user);
  if (get('SELECT id FROM files WHERE folder_id=?', folder.id) || get('SELECT id FROM folders WHERE parent_id=?', folder.id)) fail(409, 'Folder must be empty, including trashed files');
  run('DELETE FROM folders WHERE id=?', folder.id);
  res.json({ ok: true });
}
