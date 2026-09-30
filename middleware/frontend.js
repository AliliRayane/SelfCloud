import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';

export function frontend(directory) {
  const router = express.Router();
  router.use(express.static(directory, {
    index: false,
    dotfiles: 'allow',
    setHeaders(res, filename) {
      res.set('Cache-Control', filename.startsWith(path.join(directory, 'assets') + path.sep)
        ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  }));
  router.get('/{*path}', (req, res) => {
    // SPA navigation may fall back to HTML; scripts and styles must never do so.
    if (path.extname(req.path) || req.path.startsWith('/assets/') || req.path.startsWith('/@')) {
      return res.status(404).type('text/plain').send('Asset not found. Reload the page; for development open the Vite URL on port 5173.');
    }
    if (!req.accepts('html')) return res.status(404).end();
    const index = path.join(directory, 'index.html');
    res.set('Cache-Control', 'no-store');
    if (!existsSync(index)) return res.status(503).type('text/plain').send('Frontend not built. Run npm start to build and serve it, or npm run dev and open http://localhost:5173.');
    res.sendFile(index, { dotfiles: 'allow' });
  });
  return router;
}
