import bcrypt from 'bcryptjs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config/index.js';
import { all, get, run, setting, setSetting, transaction } from '../model/database.js';
import { createUser, listUsers, publicUser, usage, userById, userByName } from '../model/user.js';
import { digest } from '../middleware/auth.js';
import { fail, positive, text } from '../middleware/security.js';

function credentials(body) {
  const username = text(body.username, 'username', 64);
  if (!/^[\p{L}\p{N}_.-]+$/u.test(username)) fail(400, 'Username may contain letters, numbers, dots, underscores and hyphens');
  if (typeof body.password !== 'string' || body.password.length < 12 || Buffer.byteLength(body.password) > 72) fail(400, 'Password must be at least 12 characters and at most 72 bytes');
  return { username, password: body.password };
}
function limits(body) {
  return { defaultQuota: positive(body.defaultQuota, 'default quota'), maxUpload: positive(body.maxUpload, 'upload size'),
    trashDays: positive(body.trashDays, 'trash retention'), language: body.language === 'fr' ? 'fr' : 'en' };
}
export function status(req, res) {
  res.json({ initialized: Boolean(get('SELECT id FROM users LIMIT 1')), language: setting('language', 'en') });
}
export async function setup(req, res) {
  if (get('SELECT id FROM users LIMIT 1')) fail(409, 'Setup already completed');
  const supplied = Buffer.from(String(req.body.token || ''));
  const expected = Buffer.from(config.setupToken);
  if (!expected.length || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) fail(403, 'Invalid setup token');
  const { username, password } = credentials(req.body);
  const values = limits(req.body);
  const hash = await bcrypt.hash(password, 12);
  const user = transaction(() => {
    if (get('SELECT id FROM users LIMIT 1')) fail(409, 'Setup already completed');
    for (const [key, value] of Object.entries(values)) setSetting(key, value);
    return createUser(username, hash, 'admin', values.defaultQuota);
  });
  res.status(201).json(user);
}
export async function login(req, res) {
  const user = typeof req.body.username === 'string' && userByName(req.body.username);
  if (typeof req.body.password !== 'string' || Buffer.byteLength(req.body.password) > 72) fail(401, 'Invalid username or password');
  // A dummy hash ensures nonexistent accounts also pay the bcrypt cost.
  const valid = await bcrypt.compare(req.body.password, user?.password || '$2b$12$2QYrVpDCp93OXGiKbMu8yeh/B8YXVB4O7DMb8.hHtPBynULywfMoS');
  if (!user || user.disabled || !valid) fail(401, 'Invalid username or password');
  run('DELETE FROM sessions WHERE expires<?', Date.now());
  const token = randomBytes(32).toString('hex');
  run('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)', digest(token), user.id, Date.now() + 7 * 86400000);
  res.cookie('selfcloud', token, { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, maxAge: 7 * 86400000, path: '/' });
  res.json(publicUser(user));
}
export function logout(req, res) {
  const token = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('selfcloud='))?.slice(10);
  if (token) run('DELETE FROM sessions WHERE token=?', digest(token));
  res.clearCookie('selfcloud', { path: '/', secure: config.secureCookies, sameSite: 'lax' });
  res.json({ ok: true });
}
export function me(req, res) { res.json({ ...publicUser(req.user), used: usage(req.user.id), maxUpload: setting('maxUpload', 2 * 1024 ** 3) }); }
export async function changePassword(req, res) {
  if (typeof req.body.currentPassword !== 'string' || !(await bcrypt.compare(req.body.currentPassword, req.user.password))) fail(403, 'Current password is incorrect');
  credentials({ username: req.user.username, password: req.body.password });
  run('UPDATE users SET password=? WHERE id=?', await bcrypt.hash(req.body.password, 12), req.user.id);
  run('DELETE FROM sessions WHERE user_id=?', req.user.id);
  res.clearCookie('selfcloud', { path: '/' });
  res.json({ ok: true });
}
export function users(req, res) { res.json(listUsers()); }
export async function addUser(req, res) {
  const { username, password } = credentials(req.body);
  if (userByName(username)) fail(409, 'Username already exists');
  const quota = positive(req.body.quota ?? setting('defaultQuota', 20 * 1024 ** 3), 'quota');
  res.status(201).json(createUser(username, await bcrypt.hash(password, 12), 'user', quota));
}
export async function updateUser(req, res) {
  const user = userById(req.params.id);
  if (!user) fail(404, 'User not found');
  if (user.role === 'admin' && req.body.disabled) fail(400, 'Administrator accounts cannot be disabled');
  const quota = positive(req.body.quota ?? user.quota, 'quota');
  const hash = req.body.password ? (credentials({ username: user.username, password: req.body.password }), await bcrypt.hash(req.body.password, 12)) : user.password;
  run('UPDATE users SET quota=?,disabled=?,password=? WHERE id=?', quota, Number(req.body.disabled ?? Boolean(user.disabled)), hash, user.id);
  if (req.body.password || req.body.disabled) run('DELETE FROM sessions WHERE user_id=?', user.id);
  res.json(publicUser(userById(user.id)));
}
export function settings(req, res) {
  res.json(Object.fromEntries(['defaultQuota','maxUpload','trashDays','language'].map(key => [key, setting(key, key === 'language' ? 'en' : 30)])));
}
export function updateSettings(req, res) {
  const values = limits(req.body);
  transaction(() => { for (const [key, value] of Object.entries(values)) setSetting(key, value); });
  res.json(values);
}
