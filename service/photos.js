import sharp from 'sharp';
import exifr from 'exifr';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { get, run } from '../model/database.js';
import { usage, userById } from '../model/user.js';
import { originalPath, previewPath, temporary, diskCheck } from './storage.js';

const execute = promisify(execFile);
sharp.cache({ memory: 32, files: 0, items: 20 });
sharp.concurrency(1);
let working = false;
let stopped = false;
const serializable = (value) => JSON.parse(JSON.stringify(value, (key, item) => {
  if (typeof item === 'bigint') return item.toString();
  if (ArrayBuffer.isView(item)) return { encoding: 'base64', data: Buffer.from(item.buffer, item.byteOffset, item.byteLength).toString('base64') };
  return item;
}));
export async function processNextPhoto() {
  if (working || stopped) return false;
  const file = get("SELECT * FROM files WHERE state='pending' AND trashed_at IS NULL ORDER BY uploaded_at LIMIT 1");
  if (!file) return false;
  working = true;
  run("UPDATE files SET state='processing' WHERE id=?", file.id);
  const warnings = [];
  const metadata = { extractionVersion: 1, extractedAt: new Date().toISOString(), embedded: {}, image: {} };
  let preview;
  let converted;
  let image;
  let captured = null;
  try {
    if (!file.is_photo) {
      run("UPDATE files SET state='ready' WHERE id=?", file.id);
      return true;
    }
    const source = originalPath(file.id);
    try {
      const embedded = await exifr.parse(source, { tiff: true, exif: true, gps: true, xmp: true, iptc: true, icc: true, ihdr: true, mergeOutput: false });
      metadata.embedded = serializable(embedded || {});
      const date = embedded?.exif?.DateTimeOriginal || embedded?.DateTimeOriginal || embedded?.exif?.CreateDate;
      if (date instanceof Date && !Number.isNaN(date.getTime())) captured = date.toISOString();
    } catch (error) { warnings.push(`Metadata extraction: ${error.message}`); }
    let input = source;
    try { image = await sharp(input, { limitInputPixels: 100000000 }).metadata(); }
    catch (error) {
      // Debian's libheif converter provides HEIC support beyond sharp's prebuilt codecs.
      if (/\.(heic|heif)$/i.test(file.name)) {
        converted = path.join(temporary, `${file.id}.jpg`);
        await execute('heif-convert', [source, converted], { timeout: 60000, maxBuffer: 1024 * 1024 });
        input = converted;
        image = await sharp(input, { limitInputPixels: 100000000 }).metadata();
      } else throw error;
    }
    metadata.image = serializable(image);
    preview = await sharp(input, { limitInputPixels: 100000000 }).rotate().resize(1800, 1800, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    await diskCheck(preview.length);
    const user = userById(file.owner_id);
    if (usage(user.id) + preview.length - file.preview_size > user.quota) {
      warnings.push('Preview skipped because the user quota is full');
      preview = undefined;
    }
    if (preview) await sharp(preview).toFile(previewPath(file.id));
  } catch (error) { warnings.push(`Preview generation: ${error.message}`); }
  finally {
    if (converted) await unlink(converted).catch(() => {});
    if (file.is_photo) {
      run(`UPDATE files SET state=?,metadata=?,captured_at=?,width=?,height=?,preview_size=?,processing_error=? WHERE id=?`,
        preview ? 'ready' : 'unsupported', JSON.stringify(metadata), captured, image?.width || null, image?.height || null,
        preview?.length || 0, warnings.length ? warnings.join('\n') : null, file.id);
    }
    working = false;
  }
  return true;
}
export function startPhotoWorker() {
  stopped = false;
  const timer = setInterval(() => processNextPhoto().catch(error => console.error('Photo worker', error)), 750);
  timer.unref();
  return () => { stopped = true; clearInterval(timer); };
}
