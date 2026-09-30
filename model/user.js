import { randomUUID } from 'node:crypto';
import { all, get, run } from './database.js';

export const publicUser = (user) => user && ({ id: user.id, username: user.username, role: user.role, quota: user.quota, disabled: Boolean(user.disabled) });
export const userById = (id) => get('SELECT * FROM users WHERE id=?', id);
export const userByName = (name) => get('SELECT * FROM users WHERE username=?', name);
export const listUsers = () => all(`SELECT u.id,u.username,u.role,u.quota,u.disabled,
 COALESCE((SELECT SUM(size+preview_size) FROM files WHERE owner_id=u.id),0) AS used FROM users u ORDER BY username`);
export function createUser(username, password, role, quota) {
  const id = randomUUID();
  run('INSERT INTO users(id,username,password,role,quota) VALUES(?,?,?,?,?)', id, username, password, role, quota);
  return publicUser(userById(id));
}
export const usage = (id) => get('SELECT COALESCE(SUM(size+preview_size),0) AS bytes FROM files WHERE owner_id=?', id).bytes;
