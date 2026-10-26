import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import decodeJpeg, { init as initJpegDec } from '@jsquash/jpeg/decode.js';
import decodePng, { init as initPngDec } from '@jsquash/png/decode.js';
import decodeWebp, { init as initWebpDec } from '@jsquash/webp/decode.js';
import type { Element, ElementContent, Root } from 'hast';
import { visit } from 'unist-util-visit';
import type { VFile } from 'vfile';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BLOG_DIR = path.join(ROOT_DIR, 'public', 'blog');
const DERIVED_DIR = path.join(BLOG_DIR, '_derived');

type ImageDecoder = (buffer: ArrayBuffer) => Promise<{ width: number; height: number }>;
type WasmInitializer = (module: WebAssembly.Module) => Promise<unknown>;
type ParagraphLocation = { parent: Root | Element; index: number };
type ImageJob = { node: Element; parent: Root | Element | null | undefined };
type DerivedImage = { path: string; url: string };
type ResolvedImage = {
  originalPath: string;
  originalDecoder: ImageDecoder;
  derived: DerivedImage | null;
};

const decoders: Record<string, ImageDecoder | undefined> = {
  '.jpg': decodeJpeg,
  '.jpeg': decodeJpeg,
  '.png': decodePng,
  '.webp': decodeWebp,
};

let wasmInitialization: Promise<void> | undefined;
let processingQueue: Promise<void> = Promise.resolve();

function toArrayBuffer(bytes: Buffer): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function initializeWasm(): Promise<void> {
  const load = async (modulePath: string) =>
    WebAssembly.compile(
      toArrayBuffer(await readFile(path.join(ROOT_DIR, 'node_modules', modulePath)))
    );
  const [jpegModule, pngModule, webpModule] = await Promise.all([
    load('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm'),
    load('@jsquash/png/codec/pkg/squoosh_png_bg.wasm'),
    load('@jsquash/webp/codec/dec/webp_dec.wasm'),
  ]);
  await Promise.all([
    (initJpegDec as unknown as WasmInitializer)(jpegModule),
    (initPngDec as unknown as WasmInitializer)(pngModule),
    (initWebpDec as unknown as WasmInitializer)(webpModule),
  ]);
}

function initWasm(): Promise<void> {
  wasmInitialization ??= initializeWasm();
  return wasmInitialization;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function contentImageError(file: VFile, originalUrl: string, message: string): Error {
  const source = file.path || 'unknown Markdown source';
  return new Error(`${source}: ${message}; image: ${originalUrl}`);
}

function hasPathPrefix(parent: string, candidate: string): boolean {
  return candidate === parent || candidate.startsWith(`${parent}${path.sep}`);
}

function derivedImage(originalPath: string): DerivedImage | null {
  const relative = path.relative(BLOG_DIR, originalPath);
  const segments = relative.split(path.sep);
  const slug = segments[0];
  if (segments.length < 2 || !slug) return null;

  const basename = path.basename(originalPath, path.extname(originalPath));
  const derivedPath = path.resolve(DERIVED_DIR, slug, `${basename}.webp`);
  if (!hasPathPrefix(DERIVED_DIR, derivedPath)) return null;

  return {
    path: derivedPath,
    url: `/blog/_derived/${encodeURIComponent(slug)}/${encodeURIComponent(basename)}.webp`,
  };
}

function resolveContentImage(originalUrl: string, file: VFile): ResolvedImage | null {
  if (!originalUrl.startsWith('/blog/')) return null;

  const pathEnd = originalUrl.search(/[?#]/);
  const urlPath = pathEnd === -1 ? originalUrl : originalUrl.slice(0, pathEnd);
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(urlPath);
  } catch (error) {
    throw contentImageError(file, originalUrl, `Invalid URI path: ${errorMessage(error)}`);
  }

  const originalPath = path.resolve(BLOG_DIR, decodedPath.slice('/blog/'.length));
  if (!hasPathPrefix(BLOG_DIR, originalPath)) {
    throw contentImageError(file, originalUrl, 'Image path resolves outside public/blog');
  }

  const originalDecoder = decoders[path.extname(originalPath).toLowerCase()];
  if (!originalDecoder) return null;

  return {
    originalPath,
    originalDecoder,
    derived: derivedImage(originalPath),
  };
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code === 'ENOENT' || code === 'ENOTDIR') return false;
    throw error;
  }
}

async function imageFileExists(
  filePath: string,
  originalUrl: string,
  file: VFile
): Promise<boolean> {
  try {
    return await isFile(filePath);
  } catch (error) {
    throw contentImageError(
      file,
      originalUrl,
      `Unable to inspect ${filePath}: ${errorMessage(error)}`
    );
  }
}

async function readDimensions(
  filePath: string,
  decoder: ImageDecoder,
  originalUrl: string,
  file: VFile
): Promise<{ width: number; height: number }> {
  try {
    await initWasm();
    const image = await decoder(toArrayBuffer(await readFile(filePath)));
    return { width: image.width, height: image.height };
  } catch (error) {
    throw contentImageError(
      file,
      originalUrl,
      `Unable to decode ${filePath}: ${errorMessage(error)}`
    );
  }
}

function standaloneParagraphImage(paragraph: Element): Element | null {
  const children = paragraph.children.filter(
    (child) => child.type !== 'text' || child.value.trim() !== ''
  );
  if (children.length !== 1) return null;
  const child = children[0];
  return child?.type === 'element' && child.tagName === 'img' ? child : null;
}

function createFigure(image: Element, originalUrl: string, title: string): Element {
  const caption: ElementContent[] = [];
  if (title) {
    caption.push({ type: 'text', value: title }, { type: 'text', value: ' · ' });
  }
  caption.push({
    type: 'element',
    tagName: 'a',
    properties: {
      className: ['figure-original'],
      href: originalUrl,
      target: '_blank',
      rel: ['noopener', 'noreferrer'],
      'aria-label': 'View original image',
    },
    children: [{ type: 'text', value: 'View original ↗' }],
  });

  const alt = typeof image.properties?.alt === 'string' ? image.properties.alt.trim() : '';
  const originalLabel = alt ? `${alt} — View original image` : 'View original image';

  return {
    type: 'element',
    tagName: 'figure',
    properties: {},
    children: [
      {
        type: 'element',
        tagName: 'a',
        properties: {
          className: ['figure-link'],
          href: originalUrl,
          target: '_blank',
          rel: ['noopener', 'noreferrer'],
          'data-image-original': originalUrl,
          'aria-label': originalLabel,
        },
        children: [image],
      },
      {
        type: 'element',
        tagName: 'figcaption',
        properties: {},
        children: caption,
      },
    ],
  };
}

async function processImage(
  job: ImageJob,
  file: VFile,
  paragraphLocations: WeakMap<Element, ParagraphLocation>
): Promise<void> {
  const node = job.node;
  const originalUrl = node.properties?.src;
  if (typeof originalUrl !== 'string') return;

  const resolved = resolveContentImage(originalUrl, file);
  if (!resolved) return;
  if (!(await imageFileExists(resolved.originalPath, originalUrl, file))) {
    throw contentImageError(
      file,
      originalUrl,
      `Missing content image or not a file: ${resolved.originalPath}`
    );
  }

  const useDerived =
    resolved.derived !== null &&
    (await imageFileExists(resolved.derived.path, originalUrl, file));
  const displayPath =
    useDerived && resolved.derived ? resolved.derived.path : resolved.originalPath;
  const displayDecoder = useDerived ? decodeWebp : resolved.originalDecoder;
  const dimensions = await readDimensions(displayPath, displayDecoder, originalUrl, file);

  node.properties ??= {};
  if (useDerived && resolved.derived) node.properties.src = resolved.derived.url;
  node.properties.width = dimensions.width;
  node.properties.height = dimensions.height;

  const paragraph =
    job.parent?.type === 'element' && job.parent.tagName === 'p' ? job.parent : null;
  if (!paragraph || standaloneParagraphImage(paragraph) !== node) return;

  const location = paragraphLocations.get(paragraph);
  if (!location) return;
  const title = typeof node.properties.title === 'string' ? node.properties.title.trim() : '';
  delete node.properties.title;
  location.parent.children[location.index] = createFigure(node, originalUrl, title);
}

/** Adds content-image dimensions, derived sources, figures, and lazy-loading hints. */
export function rehypeContentImages() {
  return (tree: Root, file: VFile): Promise<void> => {
    const jobs: ImageJob[] = [];
    const paragraphLocations = new WeakMap<Element, ParagraphLocation>();

    visit(tree, 'element', (node, index, parent) => {
      if (
        node.tagName === 'p' &&
        parent != null &&
        typeof index === 'number' &&
        standaloneParagraphImage(node)
      ) {
        paragraphLocations.set(node, { parent, index });
      }
      if (node.tagName !== 'img') return;

      node.properties ??= {};
      node.properties.loading ??= 'lazy';
      node.properties.decoding ??= 'async';
      jobs.push({ node, parent });
    });

    const result = processingQueue.then(async () => {
      for (const job of jobs) await processImage(job, file, paragraphLocations);
    });
    processingQueue = result.catch(() => {});
    return result;
  };
}
