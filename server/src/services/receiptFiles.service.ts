import { bucket } from '../config/firebase.js';
import { HttpError } from '../utils/httpError.js';

const EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/tiff': '.tiff',
  'application/pdf': '.pdf',
};

const SIGNED_URL_MINUTES = 10;

export const isFileStorageConfigured = () => bucket !== null;

/**
 * Keeps the uploaded receipt as evidence for review. Returns the object path,
 * or null when storage is not configured or the upload failed — a scan is never
 * lost because its evidence could not be kept; the caller flags it instead.
 */
export async function storeReceiptFile(input: {
  ownerUid: string;
  documentId: string;
  buffer: Buffer;
  contentType: string;
}): Promise<string | null> {
  if (!bucket) return null;

  const path = `receipts/${input.ownerUid}/${input.documentId}${EXTENSIONS[input.contentType] ?? ''}`;
  try {
    await bucket.file(path).save(input.buffer, {
      contentType: input.contentType,
      resumable: false,
      metadata: { metadata: { ownerUid: input.ownerUid, documentId: input.documentId } },
    });
    return path;
  } catch (error) {
    console.error(`[receipts] could not store ${path}:`, (error as Error).message);
    return null;
  }
}

/** Best effort: used to clean up after a scan that did not go through. */
export async function deleteReceiptFile(path: string): Promise<void> {
  await bucket?.file(path).delete({ ignoreNotFound: true }).catch(() => undefined);
}

/** A short-lived link, so the admin panel can show the file while the bucket stays private. */
export async function signedReceiptUrl(path: string): Promise<string> {
  if (!bucket) throw new HttpError(404, 'File storage is not configured');

  const [url] = await bucket.file(path).getSignedUrl({
    action: 'read',
    expires: Date.now() + SIGNED_URL_MINUTES * 60_000,
  });
  return url;
}
