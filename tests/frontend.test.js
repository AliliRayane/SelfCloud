import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { frontend } from '../middleware/frontend.js';

test('frontend serves modules as JavaScript and never falls back to HTML for missing assets', async () => {
  const directory = await mkdtemp(path.resolve('tests/.runtime-'));
  const app = express();
  app.use(frontend(directory));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base)).status, 503);
    await mkdir(path.join(directory, 'assets'));
    await writeFile(path.join(directory, 'index.html'), '<html><script type="module" src="/assets/app-123.js"></script></html>');
    await writeFile(path.join(directory, 'assets/app-123.js'), 'export const loaded = true;');
    for (const url of ['/', '/photos']) {
      const page = await fetch(base + url);
      assert.equal(page.status, 200);
      assert.match(page.headers.get('content-type'), /text\/html/);
      assert.equal(page.headers.get('cache-control'), 'no-store');
    }
    const module = await fetch(base + '/assets/app-123.js');
    assert.equal(module.status, 200);
    assert.match(module.headers.get('content-type'), /(?:application|text)\/javascript/);
    assert.match(await module.text(), /export const/);
    for (const url of ['/assets/old-build.js', '/main.jsx', '/@vite/client', '/missing.css']) {
      const missing = await fetch(base + url);
      assert.equal(missing.status, 404);
      assert.doesNotMatch(missing.headers.get('content-type'), /text\/html/);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
