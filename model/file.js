import { all, get } from './database.js';
import { fail } from '../middleware/security.js';

export function ownedFile(id, user) {
  const file = get('SELECT * FROM files WHERE id=? AND owner_id=?', id, user.id);
  if (!file) fail(404, 'File not found');
  return file;
}
export function accessibleFile(id, user) {
  const file = get(`SELECT f.* FROM files f WHERE f.id=? AND (f.owner_id=? OR
    (f.trashed_at IS NULL AND EXISTS(SELECT 1 FROM shares s JOIN members m ON m.group_id=s.group_id
      WHERE s.file_id=f.id AND m.user_id=?)))`, id, user.id, user.id);
  if (!file) fail(404, 'File not found');
  return file;
}
export function ownedFolder(id, user) {
  if (!id) return null;
  const folder = get('SELECT * FROM folders WHERE id=? AND owner_id=?', id, user.id);
  if (!folder) fail(404, 'Folder not found');
  return folder;
}
export function groupAccess(id, user, allowAdmin = false) {
  const group = get(`SELECT g.* FROM groups g WHERE g.id=? AND
    (?=1 OR EXISTS(SELECT 1 FROM members WHERE group_id=g.id AND user_id=?))`, id, Number(allowAdmin && user.role === 'admin'), user.id);
  if (!group) fail(404, 'Group not found');
  return group;
}
export function fileList(user, { folder, trash, photos, group, offset = 0 }) {
  const params = [];
  let where;
  if (group) {
    groupAccess(group, user);
    where = 'f.trashed_at IS NULL AND EXISTS(SELECT 1 FROM shares WHERE file_id=f.id AND group_id=?)';
    params.push(group);
  } else {
    where = 'f.owner_id=? AND f.trashed_at IS ' + (trash ? 'NOT NULL' : 'NULL');
    params.push(user.id);
    if (!trash && !photos) { ownedFolder(folder, user); where += ' AND f.folder_id IS ?'; params.push(folder || null); }
  }
  if (photos) where += ' AND f.is_photo=1';
  return all(`SELECT f.id,f.owner_id,f.folder_id,f.name,f.mime,f.size,f.uploaded_at,f.trashed_at,
    f.state,f.captured_at,f.width,f.height,f.is_photo,u.username AS owner
    FROM files f JOIN users u ON u.id=f.owner_id WHERE ${where}
    ORDER BY COALESCE(f.captured_at,f.uploaded_at) DESC,f.id LIMIT 201 OFFSET ?`, ...params, offset);
}
