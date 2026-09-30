import { createHash } from 'node:crypto';
import { get } from '../model/database.js';

export const digest = (token) => createHash('sha256').update(token).digest('hex');
export function authenticate(req, res, next) {
  const token = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('selfcloud='))?.slice(10);
  req.user = token && get(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token=? AND s.expires>? AND u.disabled=0`, digest(token), Date.now());
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  next();
}
export function admin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Administrator required' });
  next();
}
