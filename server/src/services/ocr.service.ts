import vision from '@google-cloud/vision';
import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';

const client = new vision.ImageAnnotatorClient(
  env.VISION_KEY_FILE ? { keyFilename: env.VISION_KEY_FILE } : {},
);

export interface OcrBlock {
  text: string;
  confidence: number;
}

export interface OcrResult {
  text: string;
  locale?: string;
  blocks: OcrBlock[];
  /**
   * The text rebuilt row by row from word positions — what scoring reads.
   * Empty when Vision returned no geometry; fall back to `text` then.
   */
  lines: string[];
}

/* ---------------------------------------------------------- row rebuilding */

// Structural slices of Vision's page types, so both the image and the file
// responses fit without importing the generated protobuf typings.
interface Vertex {
  x?: number | null;
  y?: number | null;
}

interface VisionWord {
  boundingBox?: { vertices?: Vertex[] | null; normalizedVertices?: Vertex[] | null } | null;
  symbols?: { text?: string | null; property?: { detectedBreak?: { type?: unknown } | null } | null }[] | null;
}

interface VisionPage {
  width?: number | null;
  height?: number | null;
  blocks?: { paragraphs?: { words?: VisionWord[] | null }[] | null }[] | null;
}

interface PlacedWord {
  text: string;
  spaceAfter: boolean;
  corners: { x: number; y: number }[];
}

function placeWord(word: VisionWord, page: VisionPage): PlacedWord | null {
  const text = (word.symbols ?? []).map((symbol) => symbol.text ?? '').join('');
  const box = word.boundingBox;
  // Images come back in pixels; PDF pages in 0–1, scaled here so both axes share a unit.
  const absolute = box?.vertices?.length === 4 && box.vertices.some((v) => v.x || v.y);
  const raw = absolute ? box!.vertices! : box?.normalizedVertices;
  if (!text || raw?.length !== 4) return null;

  const scaleX = absolute ? 1 : page.width || 1;
  const scaleY = absolute ? 1 : page.height || 1;
  const lastSymbol = word.symbols?.at(-1);

  return {
    text,
    spaceAfter: Boolean(lastSymbol?.property?.detectedBreak?.type),
    corners: raw.map((v) => ({ x: (v.x ?? 0) * scaleX, y: (v.y ?? 0) * scaleY })),
  };
}

/**
 * Receipts are columns — description on the left, amount on the right — and
 * Vision's own text often emits each column as its own block, which tears
 * "3 PARACETAMOL … 135.00" into two distant lines. Rebuilding rows from word
 * positions keeps each row whole. The page is first turned by the words' mean
 * reading angle (Vision orders each box's corners along the text), so a tilted
 * or sideways photo still yields horizontal rows.
 */
export function rebuildLines(pages: VisionPage[]): string[] {
  const lines: string[] = [];

  for (const page of pages) {
    const words = (page.blocks ?? [])
      .flatMap((block) => block.paragraphs ?? [])
      .flatMap((paragraph) => paragraph.words ?? [])
      .map((word) => placeWord(word, page))
      .filter((word): word is PlacedWord => word !== null);
    if (words.length === 0) continue;

    // Circular mean, so a mix of +179° and -179° averages to 180°, not 0°.
    let sin = 0;
    let cos = 0;
    for (const { corners } of words) {
      const angle = Math.atan2(corners[1]!.y - corners[0]!.y, corners[1]!.x - corners[0]!.x);
      sin += Math.sin(angle);
      cos += Math.cos(angle);
    }
    const theta = Math.atan2(sin, cos);
    const [c, s] = [Math.cos(theta), Math.sin(theta)];

    const boxes = words.map((word) => {
      const turned = word.corners.map(({ x, y }) => ({ x: x * c + y * s, y: -x * s + y * c }));
      const xs = turned.map((point) => point.x);
      const ys = turned.map((point) => point.y);
      const top = Math.min(...ys);
      const bottom = Math.max(...ys);
      return { word, x0: Math.min(...xs), x1: Math.max(...xs), y: (top + bottom) / 2, height: bottom - top };
    });

    const heights = boxes.map((box) => box.height).sort((a, b) => a - b);
    const rowHeight = heights[Math.floor(heights.length / 2)] || 1;

    boxes.sort((a, b) => a.y - b.y);
    const rows: { y: number; members: typeof boxes }[] = [];
    for (const box of boxes) {
      const row = rows.at(-1);
      if (row && Math.abs(box.y - row.y) <= rowHeight * 0.5) {
        row.members.push(box);
        row.y += (box.y - row.y) / row.members.length;
      } else {
        rows.push({ y: box.y, members: [box] });
      }
    }

    for (const row of rows) {
      row.members.sort((a, b) => a.x0 - b.x0);
      let line = '';
      row.members.forEach((box, index) => {
        const previous = row.members[index - 1];
        // Vision splits "135.00" or "15/09/2026" into several words with no
        // break between them; only a real gap or a detected break is a space.
        const gap = previous && (previous.word.spaceAfter || box.x0 - previous.x1 > rowHeight * 0.3);
        line += (gap ? ' ' : '') + box.word.text;
      });
      lines.push(line.trim());
    }
  }

  return lines.filter(Boolean);
}

/* ----------------------------------------------------------------- entries */

/**
 * Runs document text detection over an image buffer.
 * Swap `documentTextDetection` for `textDetection` if you OCR photos of signs
 * or labels rather than dense documents.
 */
export async function extractTextFromImage(image: Buffer): Promise<OcrResult> {
  const [result] = await client.documentTextDetection({ image: { content: image } });

  if (result.error?.message) {
    throw new HttpError(502, `Vision API error: ${result.error.message}`);
  }

  const annotation = result.fullTextAnnotation;

  return {
    text: annotation?.text ?? '',
    locale: result.textAnnotations?.[0]?.locale ?? undefined,
    blocks:
      annotation?.pages?.flatMap((page) =>
        (page.blocks ?? []).map((block) => ({
          text: (block.paragraphs ?? [])
            .flatMap((paragraph) => paragraph.words ?? [])
            .map((word) => (word.symbols ?? []).map((symbol) => symbol.text ?? '').join(''))
            .join(' '),
          confidence: block.confidence ?? 0,
        })),
      ) ?? [],
    lines: rebuildLines(annotation?.pages ?? []),
  };
}

/** Vision reads at most five pages of an inline PDF in one synchronous call. */
const PDF_PAGES = [1, 2, 3, 4, 5];

/**
 * `documentTextDetection` only takes images — a PDF sent there is rejected as
 * bad image data. PDFs go through the files endpoint instead.
 */
export async function extractTextFromPdf(pdf: Buffer): Promise<OcrResult> {
  const [result] = await client.batchAnnotateFiles({
    requests: [
      {
        inputConfig: { content: pdf, mimeType: 'application/pdf' },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        pages: PDF_PAGES,
      },
    ],
  });

  const file = result.responses?.[0];
  const pages = file?.responses ?? [];
  const failure = file?.error?.message ?? pages.find((page) => page.error?.message)?.error?.message;

  if (failure) {
    throw new HttpError(502, `Vision API error: ${failure}`);
  }

  return {
    text: pages.map((page) => page.fullTextAnnotation?.text ?? '').join('\n'),
    locale: pages[0]?.textAnnotations?.[0]?.locale ?? undefined,
    blocks: [],
    lines: rebuildLines(pages.flatMap((page) => page.fullTextAnnotation?.pages ?? [])),
  };
}

/** Picks the Vision endpoint that can actually read the uploaded type. */
export function extractText(file: Buffer, mimeType: string): Promise<OcrResult> {
  return mimeType === 'application/pdf' ? extractTextFromPdf(file) : extractTextFromImage(file);
}

/** Same as above for a file already living in Cloud Storage (gs://bucket/path). */
export async function extractTextFromGcsUri(gcsUri: string): Promise<OcrResult> {
  const [result] = await client.documentTextDetection(gcsUri);

  if (result.error?.message) {
    throw new HttpError(502, `Vision API error: ${result.error.message}`);
  }

  return {
    text: result.fullTextAnnotation?.text ?? '',
    locale: result.textAnnotations?.[0]?.locale ?? undefined,
    blocks: [],
    lines: rebuildLines(result.fullTextAnnotation?.pages ?? []),
  };
}
