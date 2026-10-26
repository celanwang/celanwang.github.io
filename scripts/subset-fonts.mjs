#!/usr/bin/env node
/**
 * Self-hosted font subsetting.
 *
 * Scans site sources for every character actually used, then subsets the
 * pinned upstream TTFs (scripts/fonts-src/) into woff2 files in public/fonts/.
 * Runs automatically via the prebuild hook; re-run manually with:
 *
 *   npm run fonts
 *
 * Sources are downloaded once from the jsDelivr mirror of google/fonts
 * (raw.githubusercontent.com is unreachable from some networks). If the
 * download fails but subsets already exist, the build continues with a
 * warning instead of failing.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(root, 'scripts', 'fonts-src');
const OUT_DIR = path.join(root, 'public', 'fonts');

const MIRRORS = [
  (p) => `https://cdn.jsdelivr.net/gh/google/fonts@main/${p}`,
  (p) => `https://raw.githubusercontent.com/google/fonts/main/${p}`,
];

const SOURCES = [
  { file: 'Manrope-var.ttf', path: 'ofl/manrope/Manrope%5Bwght%5D.ttf' },
  { file: 'NotoSansSC-var.ttf', path: 'ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf' },
  { file: 'IBMPlexMono-Regular.ttf', path: 'ofl/ibmplexmono/IBMPlexMono-Regular.ttf' },
  { file: 'IBMPlexMono-Medium.ttf', path: 'ofl/ibmplexmono/IBMPlexMono-Medium.ttf' },
];

/** Latin + punctuation coverage for UI fonts. */
const LATIN_SET = [
  [0x0020, 0x007e], // printable ASCII
  [0x00a0, 0x00ff], // Latin-1 supplement (nbsp, ·, ×, …)
  [0x2000, 0x206f], // general punctuation (– — ‘’“” …)
  [0x2190, 0x21ff], // arrows (→ ←)
];

const SCAN_EXT = new Set(['.md', '.mdx', '.astro', '.ts', '.js', '.mjs']);

function charsFromRanges(ranges) {
  let out = '';
  for (const [a, b] of ranges) {
    for (let cp = a; cp <= b; cp += 1) out += String.fromCodePoint(cp);
  }
  return out;
}

async function* walk(dir) {
  for (const entry of await readdir(dir)) {
    const full = path.join(dir, entry);
    const s = await stat(full);
    if (s.isDirectory()) yield* walk(full);
    else if (SCAN_EXT.has(path.extname(entry))) yield full;
  }
}

/** Every non-ASCII codepoint used anywhere in src/ (CJK, punctuation, symbols). */
async function usedNonAscii() {
  const set = new Set();
  for await (const file of walk(path.join(root, 'src'))) {
    const text = await readFile(file, 'utf8');
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp > 0x7f) set.add(cp);
    }
  }
  return [...set].map((cp) => String.fromCodePoint(cp)).join('');
}

async function ensureSources() {
  await mkdir(SRC_DIR, { recursive: true });
  for (const src of SOURCES) {
    const dest = path.join(SRC_DIR, src.file);
    if (existsSync(dest)) continue;
    let ok = false;
    for (const mirror of MIRRORS) {
      try {
        const res = await fetch(mirror(src.path));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await writeFile(dest, Buffer.from(await res.arrayBuffer()));
        ok = true;
        break;
      } catch (err) {
        console.warn(`[fonts] ${src.file}: mirror failed (${err.message})`);
      }
    }
    if (!ok) throw new Error(`could not download ${src.file}`);
  }
}

async function subset({ input, output, text }) {
  const ttf = await readFile(path.join(SRC_DIR, input));
  const out = await subsetFont(ttf, text, { targetFormat: 'woff2' });
  await writeFile(path.join(OUT_DIR, output), out);
  const kb = (out.byteLength / 1024).toFixed(1);
  const hash = createHash('sha1').update(out).digest('hex').slice(0, 8);
  console.log(`[fonts] ${output}  ${kb} KB  sha1:${hash}`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const latin = charsFromRanges(LATIN_SET);
  const cjk = await usedNonAscii();

  try {
    await ensureSources();
  } catch (err) {
    const haveOutputs = ['manrope-latin.woff2', 'noto-sans-sc.woff2'].every((f) =>
      existsSync(path.join(OUT_DIR, f))
    );
    if (haveOutputs) {
      console.warn(`[fonts] ${err.message} — keeping existing subsets in public/fonts/`);
      return;
    }
    throw err;
  }

  await subset({ input: 'Manrope-var.ttf', output: 'manrope-latin.woff2', text: latin });
  await subset({ input: 'IBMPlexMono-Regular.ttf', output: 'ibm-plex-mono-400.woff2', text: latin });
  await subset({ input: 'IBMPlexMono-Medium.ttf', output: 'ibm-plex-mono-500.woff2', text: latin });
  await subset({ input: 'NotoSansSC-var.ttf', output: 'noto-sans-sc.woff2', text: latin + cjk });
}

main().catch((err) => {
  console.error(`[fonts] failed: ${err.message}`);
  process.exit(1);
});
