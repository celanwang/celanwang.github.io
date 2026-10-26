#!/usr/bin/env node
/**
 * Repeatable image pipeline (pure WASM — no native deps).
 *
 * scripts/images-src/blog/** is the master input. Missing masters are seeded
 * exclusively from current public/blog originals, never from derived output.
 * Every run syncs public originals from those masters and writes WebP variants
 * only under public/blog/_derived/. Avatar and OG artwork remain separate.
 *
 * Re-run manually after changing source artwork: npm run images
 */
import { constants } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import decodeJpeg, { init as initJpegDec } from '@jsquash/jpeg/decode.js';
import encodeJpeg, { init as initJpegEnc } from '@jsquash/jpeg/encode.js';
import decodePng, { init as initPngDec } from '@jsquash/png/decode.js';
import decodeWebp, { init as initWebpDec } from '@jsquash/webp/decode.js';
import encodeWebp, { init as initWebpEnc } from '@jsquash/webp/encode.js';
import resize, { initResize } from '@jsquash/resize';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(root, 'public', 'images');
const BLOG_DIR = path.join(root, 'public', 'blog');
const BLOG_MASTER_DIR = path.join(root, 'scripts', 'images-src', 'blog');
const BLOG_DERIVED_DIR = path.join(BLOG_DIR, '_derived');
const MAX_CONTENT_WIDTH = 1600;

const IMAGE_FORMATS = new Map([
  ['.png', 'png'],
  ['.jpg', 'jpeg'],
  ['.jpeg', 'jpeg'],
  ['.webp', 'webp'],
]);
const OTHER_IMAGE_EXTENSIONS = new Set([
  '.avif',
  '.bmp',
  '.gif',
  '.ico',
  '.svg',
  '.tif',
  '.tiff',
]);

/** Node has no fetch() for wasm URLs — instantiate codecs from disk. */
async function initWasm() {
  const load = (p) =>
    readFile(path.join(root, 'node_modules', p)).then((b) => WebAssembly.compile(b));
  await Promise.all([
    initJpegDec(await load('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm')),
    initJpegEnc(await load('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm')),
    initPngDec(await load('@jsquash/png/codec/pkg/squoosh_png_bg.wasm')),
    initWebpDec(await load('@jsquash/webp/codec/dec/webp_dec.wasm')),
    initWebpEnc(await load('@jsquash/webp/codec/enc/webp_enc_simd.wasm')),
    initResize(await load('@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm')),
  ]);
}

const decoders = { jpeg: decodeJpeg, png: decodePng, webp: decodeWebp };

function formatForFile(file) {
  return IMAGE_FORMATS.get(path.extname(file).toLowerCase()) ?? null;
}

function isImageFile(file) {
  return formatForFile(file) !== null || OTHER_IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase());
}

function compareNames(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

async function* walk(dir, { skipDerived = false } = {}) {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => compareNames(a.name, b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skipDerived && entry.name === '_derived') continue;
      yield* walk(full, { skipDerived });
    } else if (entry.isFile()) {
      yield full;
    } else {
      throw new Error(`Unsupported filesystem entry: ${full}`);
    }
  }
}

async function migrateMasters() {
  let copied = 0;
  let existing = 0;
  await mkdir(BLOG_MASTER_DIR, { recursive: true });

  for await (const file of walk(BLOG_DIR, { skipDerived: true })) {
    if (!isImageFile(file)) continue;
    const rel = path.relative(BLOG_DIR, file);
    const master = path.join(BLOG_MASTER_DIR, rel);
    await mkdir(path.dirname(master), { recursive: true });
    try {
      await copyFile(file, master, constants.COPYFILE_EXCL);
      copied += 1;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      existing += 1;
    }
  }

  console.log(`[images] blog masters  ${copied} seeded from current public files, ${existing} kept`);
}

async function loadMetadata(slug) {
  const file = path.join(BLOG_MASTER_DIR, slug, 'images.json');
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  let metadata;
  try {
    metadata = JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid ${file}: ${err.message}`);
  }
  if (!Array.isArray(metadata)) throw new Error(`${file} must contain an array`);
  for (const [index, item] of metadata.entries()) {
    if (item === null) continue;
    if (typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${file}[${index}] must be an object or null`);
    }
    if ('file' in item && typeof item.file !== 'string') {
      throw new Error(`${file}[${index}].file must be a string`);
    }
    if ('kind' in item && typeof item.kind !== 'string') {
      throw new Error(`${file}[${index}].kind must be a string`);
    }
  }
  return metadata;
}

function matchesMetadataFile(item, entry) {
  if (typeof item.file !== 'string') return false;
  const configured = item.file.replace(/^\.\//, '');
  return configured === entry.name || configured === entry.metadataPath;
}

function metadataFor(entries, entry) {
  const explicit = entries.filter((item) => item && matchesMetadataFile(item, entry));
  if (explicit.length > 1) {
    throw new Error(`Multiple images.json entries match blog/${entry.rel}`);
  }
  if (explicit.length === 1) return explicit[0];

  const stem = path.basename(entry.name, path.extname(entry.name));
  const numbered = /^\d+$/.test(stem) && Number(stem) > 0 ? Number(stem) - 1 : null;
  const candidates = numbered === null ? [entry.index] : [numbered, entry.index];
  for (const index of new Set(candidates)) {
    const item = entries[index];
    if (item && (!('file' in item) || matchesMetadataFile(item, entry))) return item;
  }
  return null;
}

async function collectMasters() {
  const masters = [];
  const outputOwners = new Map();

  for await (const file of walk(BLOG_MASTER_DIR)) {
    if (!isImageFile(file)) continue;
    const rel = path.relative(BLOG_MASTER_DIR, file);
    const parts = rel.split(path.sep);
    if (parts.length < 2 || parts[0] === '_derived') {
      throw new Error(`Blog master must be under a non-reserved slug directory: ${rel}`);
    }

    const slug = parts[0];
    const name = path.basename(file);
    const format = formatForFile(file);
    const entry = {
      file,
      publicFile: path.join(BLOG_DIR, rel),
      output: path.join(BLOG_DERIVED_DIR, slug, `${path.basename(name, path.extname(name))}.webp`),
      rel,
      name,
      slug,
      format,
      index: 0,
      metadataPath: parts.slice(1).join('/'),
      metadata: null,
    };

    if (format) {
      const owner = outputOwners.get(entry.output);
      if (owner) throw new Error(`Derived output collision: ${owner} and ${rel}`);
      outputOwners.set(entry.output, rel);
    }
    masters.push(entry);
  }

  masters.sort((a, b) => compareNames(a.rel, b.rel));
  const slugIndexes = new Map();
  const metadataBySlug = new Map();
  for (const entry of masters) {
    entry.index = slugIndexes.get(entry.slug) ?? 0;
    slugIndexes.set(entry.slug, entry.index + 1);
    if (!metadataBySlug.has(entry.slug)) {
      metadataBySlug.set(entry.slug, await loadMetadata(entry.slug));
    }
    entry.metadata = metadataFor(metadataBySlug.get(entry.slug), entry);
  }
  return masters;
}

function assertSafePng(raw) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (raw.length < 8 || !signature.every((byte, index) => raw[index] === byte)) {
    throw new Error('invalid PNG signature');
  }

  let offset = 8;
  let sawHeader = false;
  while (offset < raw.length) {
    if (offset + 12 > raw.length) throw new Error('truncated PNG chunk');
    const length = raw.readUInt32BE(offset);
    const type = raw.toString('ascii', offset + 4, offset + 8);
    const data = offset + 8;
    const next = data + length + 4;
    if (next > raw.length) throw new Error('truncated PNG chunk data');

    if (type === 'IHDR') {
      if (offset !== 8 || length !== 13) throw new Error('invalid PNG header');
      sawHeader = true;
      const bitDepth = raw[data + 8];
      if (bitDepth === 16) throw new Error('16-bit PNG is not supported');
      if (![1, 2, 4, 8].includes(bitDepth)) throw new Error(`invalid PNG bit depth ${bitDepth}`);
    }
    if (type === 'acTL') throw new Error('animated PNG is not supported');
    offset = next;
    if (type === 'IEND') break;
  }
  if (!sawHeader) throw new Error('PNG has no IHDR chunk');
}

function assertSafeWebp(raw) {
  if (raw.length < 20 || raw.toString('ascii', 0, 4) !== 'RIFF' || raw.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('invalid WebP header');
  }
  const riffEnd = raw.readUInt32LE(4) + 8;
  if (riffEnd > raw.length) throw new Error('truncated WebP RIFF data');

  let offset = 12;
  while (offset < riffEnd) {
    if (offset + 8 > riffEnd) throw new Error('truncated WebP chunk');
    const length = raw.readUInt32LE(offset + 4);
    const type = raw.toString('ascii', offset, offset + 4);
    const data = offset + 8;
    const end = data + length;
    if (end > riffEnd) throw new Error('truncated WebP chunk data');
    if (type === 'VP8X') {
      if (length < 10) throw new Error('invalid WebP VP8X chunk');
      if ((raw[data] & 0x02) !== 0) throw new Error('animated WebP is not supported');
    }
    if (type === 'ANIM' || type === 'ANMF') throw new Error('animated WebP is not supported');
    offset = end + (length % 2);
  }
}

function assertSafeJpeg(raw) {
  if (raw.length < 4 || raw[0] !== 0xff || raw[1] !== 0xd8) {
    throw new Error('invalid JPEG signature');
  }
  const frameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset < raw.length) {
    if (raw[offset] !== 0xff) throw new Error('invalid JPEG marker');
    while (offset < raw.length && raw[offset] === 0xff) offset += 1;
    if (offset >= raw.length) break;
    const marker = raw[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > raw.length) throw new Error('truncated JPEG segment');
    const length = raw.readUInt16BE(offset);
    if (length < 2 || offset + length > raw.length) throw new Error('invalid JPEG segment length');
    if (frameMarkers.has(marker)) {
      const bitDepth = raw[offset + 2];
      if (bitDepth !== 8) throw new Error(`${bitDepth}-bit JPEG is not supported`);
      return;
    }
    offset += length;
  }
  throw new Error('JPEG has no supported frame header');
}

async function decodeContentImage(raw, format) {
  if (format === 'png') assertSafePng(raw);
  else if (format === 'jpeg') assertSafeJpeg(raw);
  else if (format === 'webp') assertSafeWebp(raw);
  else throw new Error('unsupported image format');

  const image = await decoders[format](raw);
  if (
    !image ||
    !Number.isInteger(image.width) ||
    !Number.isInteger(image.height) ||
    image.width < 1 ||
    image.height < 1 ||
    !image.data ||
    image.data.BYTES_PER_ELEMENT !== 1 ||
    image.data.length !== image.width * image.height * 4
  ) {
    throw new Error('decoder returned unsafe or unsupported pixel data');
  }
  return image;
}

/**
 * Rebuild only the script-owned derived tree. A fresh tree also removes stale
 * variants when a master is removed, unsafe, or no longer benefits from WebP.
 */
async function optimizeContentImages() {
  await migrateMasters();
  const masters = await collectMasters();

  // Original URLs always serve the exact master bytes, at full resolution.
  for (const entry of masters) {
    await mkdir(path.dirname(entry.publicFile), { recursive: true });
    await copyFile(entry.file, entry.publicFile);
  }

  await rm(BLOG_DERIVED_DIR, { recursive: true, force: true });
  await mkdir(BLOG_DERIVED_DIR, { recursive: true });

  let derivedCount = 0;
  let fallbackCount = 0;
  for (const entry of masters) {
    const rel = entry.rel.split(path.sep).join('/');
    if (!entry.format) {
      fallbackCount += 1;
      console.warn(`[images] blog/${rel}: derived skipped (unsupported image format); using original`);
      continue;
    }

    const raw = await readFile(entry.file);
    let encoded;
    try {
      let image = await decodeContentImage(raw, entry.format);
      if (image.width > MAX_CONTENT_WIDTH) {
        image = await resize(image, {
          width: MAX_CONTENT_WIDTH,
          height: Math.max(1, Math.round((image.height * MAX_CONTENT_WIDTH) / image.width)),
        });
      }
      const options = entry.metadata?.kind === 'photo'
        ? { quality: 82 }
        : { lossless: 1, quality: 90 };
      encoded = Buffer.from(await encodeWebp(image, options));
    } catch (err) {
      fallbackCount += 1;
      console.warn(`[images] blog/${rel}: derived skipped (${err.message}); using original`);
      continue;
    }

    if (encoded.byteLength >= raw.byteLength) {
      fallbackCount += 1;
      continue;
    }

    await mkdir(path.dirname(entry.output), { recursive: true });
    await writeFile(entry.output, encoded);
    derivedCount += 1;
    console.log(`[images] blog/${rel}  ${(raw.byteLength / 1024).toFixed(0)} KB → ${(encoded.byteLength / 1024).toFixed(0)} KB WebP`);
  }

  console.log(`[images] blog content  ${derivedCount} derived WebP, ${fallbackCount} original fallbacks`);
}

async function toWebp({ src, format, width, height, quality = 82 }) {
  const raw = await readFile(path.join(root, 'scripts', 'images-src', src));
  let image = await decoders[format](raw);
  if (width !== image.width || height !== image.height) {
    image = await resize(image, { width, height });
  }
  const out = await encodeWebp(image, { quality });
  return Buffer.from(out);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await initWasm();
  const jobs = [
    { src: 'avatar.jpeg', format: 'jpeg', width: 192, height: 192, out: 'avatar.webp' },
  ];

  for (const job of jobs) {
    const buf = await toWebp(job);
    await writeFile(path.join(OUT_DIR, job.out), buf);
    console.log(`[images] ${job.out}  ${(buf.byteLength / 1024).toFixed(1)} KB`);
  }

  // OG banner: exact 1200×630, JPEG for size.
  const ogRaw = await readFile(path.join(root, 'scripts', 'images-src', 'og-default.png'));
  let og = await decodePng(ogRaw);
  og = await resize(og, { width: 1200, height: 630 });
  const ogBuf = Buffer.from(await encodeJpeg(og, { quality: 82 }));
  await writeFile(path.join(root, 'public/og-default.jpg'), ogBuf);
  console.log(`[images] og-default.jpg  ${(ogBuf.byteLength / 1024).toFixed(1)} KB`);

  await optimizeContentImages();
  await Promise.all([
    rm(path.join(root, 'node_modules', '.astro'), { recursive: true, force: true }),
    rm(path.join(root, '.astro'), { recursive: true, force: true }),
  ]);
}

main().catch((err) => {
  console.error(`[images] failed: ${err.message}`);
  process.exit(1);
});
