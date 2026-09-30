import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config/index.js';
import { authenticate, admin } from './middleware/auth.js';
import { errorHandler, sameOrigin } from './middleware/security.js';
import * as account from './controller/account.js';
import { driveRoutes } from './routes/drive.js';
import { groupRoutes } from './routes/group.js';
import { recoverStorage, cleanupTrash } from './service/storage.js';
import { startPhotoWorker } from './service/photos.js';
import { frontend } from './middleware/frontend.js';

export const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', config.trustProxy);
app.use(helmet({ contentSecurityPolicy: { directives: { imgSrc: ["'self'", 'data:', 'blob:'] } } }));
app.use(sameOrigin);
app.use(express.json({ limit: '64kb' }));
const loginLimiter = rateLimit({ windowMs: 15 * 60000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Too many attempts. Try again later.' } });
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/status', account.status);
app.post('/api/setup', loginLimiter, account.setup);
app.post('/api/login', loginLimiter, account.login);
app.post('/api/logout', account.logout);
app.get('/api/me', authenticate, account.me);
app.post('/api/password', authenticate, loginLimiter, account.changePassword);
app.get('/api/admin/users', authenticate, admin, account.users);
app.post('/api/admin/users', authenticate, admin, account.addUser);
app.patch('/api/admin/users/:id', authenticate, admin, account.updateUser);
app.get('/api/admin/settings', authenticate, admin, account.settings);
app.put('/api/admin/settings', authenticate, admin, account.updateSettings);

app.use('/api', groupRoutes);
app.use('/api', driveRoutes);
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found' }));
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
app.use(frontend(dist));
app.use(errorHandler);
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  recoverStorage();
  const stopWorker = startPhotoWorker();
  cleanupTrash();
  const cleanup = setInterval(cleanupTrash, 3600000);
  cleanup.unref();
  const server = app.listen(config.port, '0.0.0.0', () => console.log(`SelfCloud listening on port ${config.port}`));
  const shutdown = () => { stopWorker(); clearInterval(cleanup); server.close(() => process.exit(0)); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
