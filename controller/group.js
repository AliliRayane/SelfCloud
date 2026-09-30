import { randomUUID } from 'node:crypto';
import { all, get, run, transaction } from '../model/database.js';
import { groupAccess, ownedFile } from '../model/file.js';
import { fail, text } from '../middleware/security.js';

export function list(req, res) {
  res.json(all(`SELECT g.*, (SELECT COUNT(*) FROM members WHERE group_id=g.id) AS member_count
    FROM groups g WHERE EXISTS(SELECT 1 FROM members WHERE group_id=g.id AND user_id=?) ORDER BY name`, req.user.id));
}
export function adminList(req, res) {
  res.json(all('SELECT * FROM groups ORDER BY name').map(group => ({ ...group,
    members: all('SELECT user_id FROM members WHERE group_id=?', group.id).map(m => m.user_id),
    shares: all(`SELECT f.id,f.name,u.username AS owner FROM shares s JOIN files f ON f.id=s.file_id
      JOIN users u ON u.id=f.owner_id WHERE s.group_id=?`, group.id),
  })));
}
export function create(req, res) {
  const name = text(req.body.name, 'group name', 100);
  if (get('SELECT id FROM groups WHERE name=?', name)) fail(409, 'Group already exists');
  const id = randomUUID();
  run('INSERT INTO groups(id,name) VALUES(?,?)', id, name);
  res.status(201).json({ id, name });
}
export function membership(req, res) {
  groupAccess(req.params.id, req.user, true);
  const members = req.body.members;
  if (!Array.isArray(members) || members.length > 1000 || members.some(id => typeof id !== 'string' || !get('SELECT id FROM users WHERE id=?', id))) fail(400, 'Invalid group members');
  transaction(() => {
    const previous = all('SELECT user_id FROM members WHERE group_id=?', req.params.id);
    for (const { user_id: id } of previous) {
      if (!members.includes(id)) run('DELETE FROM shares WHERE group_id=? AND file_id IN (SELECT id FROM files WHERE owner_id=?)', req.params.id, id);
    }
    run('DELETE FROM members WHERE group_id=?', req.params.id);
    for (const id of new Set(members)) run('INSERT INTO members(group_id,user_id) VALUES(?,?)', req.params.id, id);
  });
  res.json({ ok: true });
}
export function remove(req, res) {
  groupAccess(req.params.id, req.user, true);
  run('DELETE FROM groups WHERE id=?', req.params.id);
  res.json({ ok: true });
}
export function share(req, res) {
  groupAccess(req.params.id, req.user);
  const file = ownedFile(req.params.file, req.user);
  if (file.trashed_at) fail(400, 'Restore the file before sharing');
  if (!file.is_photo) fail(400, 'Only photos can be shared into photo groups');
  run('INSERT OR IGNORE INTO shares(group_id,file_id) VALUES(?,?)', req.params.id, file.id);
  res.json({ ok: true });
}
export function unshare(req, res) {
  groupAccess(req.params.id, req.user, true);
  const share = get(`SELECT f.owner_id FROM shares s JOIN files f ON f.id=s.file_id WHERE s.group_id=? AND s.file_id=?`, req.params.id, req.params.file);
  if (!share) fail(404, 'Share not found');
  if (req.user.role !== 'admin' && share.owner_id !== req.user.id) fail(403, 'Only the uploader can remove this share');
  run('DELETE FROM shares WHERE group_id=? AND file_id=?', req.params.id, req.params.file);
  res.json({ ok: true });
}
