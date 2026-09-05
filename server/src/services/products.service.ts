import { FieldValue } from 'firebase-admin/firestore';
import { firestore } from '../config/firebase.js';
import { HttpError } from '../utils/httpError.js';
import type { Product, ProductInput } from '../types/campaigns.js';

const COLLECTION = 'products';

function toProduct(id: string, data: FirebaseFirestore.DocumentData): Product {
  return {
    id,
    name: data.name,
    sku: data.sku ?? undefined,
    points: data.points,
    active: data.active ?? true,
    createdAt: data.createdAt?.toDate().toISOString() ?? null,
    updatedAt: data.updatedAt?.toDate().toISOString() ?? null,
  };
}

export async function listProducts(includeInactive = true): Promise<Product[]> {
  const collection = firestore.collection(COLLECTION);
  const snapshot = await (includeInactive
    ? collection.orderBy('name')
    : collection.where('active', '==', true).orderBy('name')
  ).get();

  return snapshot.docs.map((doc) => toProduct(doc.id, doc.data()));
}

export async function getProduct(id: string): Promise<Product> {
  const doc = await firestore.collection(COLLECTION).doc(id).get();
  if (!doc.exists) throw new HttpError(404, 'Product not found');
  return toProduct(doc.id, doc.data()!);
}

export async function createProduct(input: ProductInput): Promise<Product> {
  const ref = await firestore.collection(COLLECTION).add({
    ...input,
    sku: input.sku ?? null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return getProduct(ref.id);
}

export async function updateProduct(id: string, input: Partial<ProductInput>): Promise<Product> {
  const ref = firestore.collection(COLLECTION).doc(id);
  if (!(await ref.get()).exists) throw new HttpError(404, 'Product not found');

  await ref.update({
    ...input,
    ...(input.sku === undefined ? {} : { sku: input.sku || null }),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return getProduct(id);
}

/**
 * Deleting a product that a live campaign scores against would leave that
 * campaign pointing at nothing, so refuse and let the admin deactivate instead.
 */
export async function deleteProduct(id: string): Promise<void> {
  const inUse = await firestore
    .collection('campaigns')
    .where('status', 'in', ['draft', 'active'])
    .where('productIds', 'array-contains', id)
    .limit(1)
    .get();

  if (!inUse.empty) {
    const campaign = inUse.docs[0]!.data();
    throw new HttpError(
      409,
      `"${campaign.name}" still uses this product. Archive that campaign, or deactivate the product instead.`,
    );
  }

  await firestore.collection(COLLECTION).doc(id).delete();
}
