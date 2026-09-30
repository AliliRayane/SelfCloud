import { config } from '../config/index.js';

export function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  const expected = config.origin || `${req.protocol}://${req.get('host')}`;
  // In Vite development the browser talks to port 5173 through its API proxy.
  const developmentOrigin = !config.secureCookies && !config.origin && origin === 'http://localhost:5173';
  if ((origin && origin !== expected && !developmentOrigin) || req.get('sec-fetch-site') === 'cross-site') {
    return res.status(403).json({ error: 'Cross-origin requests are not permitted' });
  }
  next();
}
export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const status = error.status || (error.code === 'LIMIT_FILE_SIZE' ? 413 : error.code?.startsWith('LIMIT_') ? 400 : 500);
  if (status >= 500) console.error(error);
  res.status(status).json({ error: status >= 500 ? 'An internal error occurred' : error.message });
}
export function fail(status, message) { throw Object.assign(new Error(message), { status }); }
export function text(value, label, max = 255) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f]/.test(value)) fail(400, `Invalid ${label}`);
  return value.trim();
}
export function positive(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(400, `Invalid ${label}`);
  return value;
}
