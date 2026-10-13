import { FieldValue, Timestamp, type DocumentReference, type Transaction } from 'firebase-admin/firestore';
import { firestore } from '../config/firebase.js';
import { HttpError } from '../utils/httpError.js';
import type { OcrResult } from './ocr.service.js';
import type {
  CampaignScore,
  ReceiptIssue,
  ScanFlag,
  ScanRecord,
  ScanScoring,
  ScanStatus,
} from '../types/scoring.js';
import { getProfileSummaries } from './users.service.js';

const COLLECTION = 'documents';

export interface DocumentRecord {
  id: string;
  ownerUid: string;
  filename: string;
  text: string;
  locale?: string;
  campaignId: string | null;
  pointsAwarded: number;
  campaign: CampaignScore | null;
  issues: ReceiptIssue[];
  receiptDate: string | null;
  createdAt: string | null;
}

/** An id handed out up front, so the scan can name its stored file and its transaction after it. */
export function newDocumentRef(): DocumentReference {
  return firestore.collection(COLLECTION).doc();
}

export function documentRef(id: string): DocumentReference {
  return firestore.collection(COLLECTION).doc(id);
}

/** Persists an OCR run, what it scored and why, against the user who requested it. */
export function writeScannedDocument(
  tx: Transaction,
  ref: DocumentReference,
  input: {
    ownerUid: string;
    filename: string;
    fileHash: string;
    filePath: string | null;
    contentType: string;
    result: OcrResult;
    scoring: ScanScoring;
    flags: ScanFlag[];
  },
): void {
  tx.set(ref, {
    ownerUid: input.ownerUid,
    filename: input.filename,
    fileHash: input.fileHash,
    filePath: input.filePath,
    contentType: input.contentType,
    text: input.result.text,
    locale: input.result.locale ?? null,
    status: (input.scoring.campaign ? 'scored' : 'unscored') satisfies ScanStatus,
    campaignId: input.scoring.campaignId,
    campaignName: input.scoring.campaignName,
    pointsAwarded: input.scoring.pointsAwarded,
    campaign: input.scoring.campaign,
    issues: input.scoring.issues,
    receiptDate: input.scoring.receiptDate,
    flags: input.flags,
    // A flat boolean so the review queue can filter on it with one index.
    flagged: input.flags.length > 0,
    voided: null,
    createdAt: FieldValue.serverTimestamp(),
  });
}

/** Scans a user sent since `since`, rejected ones included — each one cost a Vision call. */
export async function countRecentScans(ownerUid: string, since: Date): Promise<number> {
  const snapshot = await firestore
    .collection(COLLECTION)
    .where('ownerUid', '==', ownerUid)
    .where('createdAt', '>=', Timestamp.fromDate(since))
    // Same shape as listDocuments, so one (ownerUid, createdAt desc) index serves both.
    .orderBy('createdAt', 'desc')
    .count()
    .get();

  return snapshot.data().count;
}

export async function listDocuments(ownerUid: string, limit = 50): Promise<DocumentRecord[]> {
  const snapshot = await firestore
    .collection(COLLECTION)
    .where('ownerUid', '==', ownerUid)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      ownerUid: data.ownerUid,
      filename: data.filename,
      text: data.text,
      locale: data.locale ?? undefined,
      // Scans from before campaign selection stored a `campaigns` array.
      campaignId: data.campaignId ?? data.campaigns?.[0]?.campaignId ?? null,
      pointsAwarded: data.pointsAwarded ?? 0,
      campaign: data.campaign ?? data.campaigns?.[0] ?? null,
      issues: data.issues ?? [],
      receiptDate: data.receiptDate ?? null,
      createdAt: data.createdAt?.toDate().toISOString() ?? null,
    };
  });
}

/* ------------------------------------------------------------ admin review */

/** The score a document carries, including scans stored before campaign selection. */
export function scoreOf(data: FirebaseFirestore.DocumentData): CampaignScore | null {
  return data.campaign ?? data.campaigns?.[0] ?? null;
}

function toScanRecord(
  id: string,
  data: FirebaseFirestore.DocumentData,
  owner: { email: string | null; displayName: string | null } | undefined,
): ScanRecord {
  const score = scoreOf(data);
  return {
    id,
    ownerUid: data.ownerUid,
    ownerEmail: owner?.email ?? null,
    ownerName: owner?.displayName ?? null,
    filename: data.filename,
    text: data.text ?? '',
    status: data.status ?? (score ? 'scored' : 'unscored'),
    campaignId: data.campaignId ?? score?.campaignId ?? null,
    campaignName: data.campaignName ?? score?.campaignName ?? null,
    pointsAwarded: data.pointsAwarded ?? 0,
    campaign: score,
    issues: data.issues ?? [],
    flags: data.flags ?? [],
    receiptDate: data.receiptDate ?? null,
    hasFile: Boolean(data.filePath),
    contentType: data.contentType ?? null,
    voided: data.voided
      ? {
          at: data.voided.at?.toDate().toISOString() ?? null,
          by: data.voided.by,
          reason: data.voided.reason,
        }
      : null,
    createdAt: data.createdAt?.toDate().toISOString() ?? null,
  };
}

/** Newest first. `before` is the `createdAt` of the last scan already shown. */
export async function listScans(options: {
  flaggedOnly: boolean;
  before?: string;
  limit?: number;
}): Promise<{ scans: ScanRecord[]; nextBefore: string | null }> {
  const limit = options.limit ?? 30;
  const collection = firestore.collection(COLLECTION);

  let query = (options.flaggedOnly ? collection.where('flagged', '==', true) : collection).orderBy(
    'createdAt',
    'desc',
  );
  if (options.before) query = query.startAfter(Timestamp.fromDate(new Date(options.before)));

  const snapshot = await query.limit(limit + 1).get();
  const docs = snapshot.docs.slice(0, limit);
  const owners = await getProfileSummaries([...new Set(docs.map((doc) => doc.data().ownerUid as string))]);
  const scans = docs.map((doc) => toScanRecord(doc.id, doc.data(), owners.get(doc.data().ownerUid)));

  return {
    scans,
    nextBefore: snapshot.docs.length > limit ? (scans.at(-1)?.createdAt ?? null) : null,
  };
}

export async function getScan(id: string): Promise<ScanRecord> {
  const doc = await documentRef(id).get();
  if (!doc.exists) throw new HttpError(404, 'No se encontró el comprobante');

  const owners = await getProfileSummaries([doc.data()!.ownerUid]);
  return toScanRecord(doc.id, doc.data()!, owners.get(doc.data()!.ownerUid));
}

/** Where a scan's file lives in Storage, or null if it was never kept. */
export async function getScanFilePath(id: string): Promise<string | null> {
  const doc = await documentRef(id).get();
  if (!doc.exists) throw new HttpError(404, 'No se encontró el comprobante');
  return doc.data()!.filePath ?? null;
}
