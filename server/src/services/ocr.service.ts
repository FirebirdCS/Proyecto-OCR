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
}

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
  };
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
  };
}
