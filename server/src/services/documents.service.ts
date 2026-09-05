import { FieldValue } from 'firebase-admin/firestore';
import { firestore } from '../config/firebase.js';
import type { OcrResult } from './ocr.service.js';

const COLLECTION = 'documents';

export interface DocumentRecord {
  id: string;
  ownerUid: string;
  filename: string;
  text: string;
  locale?: string;
  createdAt: string | null;
}

/** Persists an OCR run against the user who requested it. */
export async function saveDocument(input: {
  ownerUid: string;
  filename: string;
  result: OcrResult;
}): Promise<string> {
  const ref = await firestore.collection(COLLECTION).add({
    ownerUid: input.ownerUid,
    filename: input.filename,
    text: input.result.text,
    locale: input.result.locale ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });

  return ref.id;
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
      createdAt: data.createdAt?.toDate().toISOString() ?? null,
    };
  });
}
