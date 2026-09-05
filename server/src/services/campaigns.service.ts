import { FieldValue } from 'firebase-admin/firestore';
import { firestore } from '../config/firebase.js';
import { HttpError } from '../utils/httpError.js';
import { assertActivatable, type Campaign, type CampaignInput, type CampaignStatus } from '../types/campaigns.js';
import { listProducts } from './products.service.js';

const COLLECTION = 'campaigns';

function toCampaign(id: string, data: FirebaseFirestore.DocumentData): Campaign {
  return {
    id,
    name: data.name,
    description: data.description ?? '',
    status: data.status,
    startsAt: data.startsAt,
    endsAt: data.endsAt,
    products: data.products ?? [],
    milestones: data.milestones ?? [],
    participantUids: data.participantUids ?? [],
    createdBy: data.createdBy,
    createdAt: data.createdAt?.toDate().toISOString() ?? null,
    updatedAt: data.updatedAt?.toDate().toISOString() ?? null,
  };
}

/**
 * Every product referenced by a campaign has to exist and be active — an admin
 * can otherwise build a campaign around a product nobody can sell.
 */
async function assertProductsExist(input: CampaignInput): Promise<void> {
  if (input.products.length === 0) return;

  const products = await listProducts();
  const byId = new Map(products.map((product) => [product.id, product]));

  const missing = input.products.filter((entry) => !byId.has(entry.productId));
  if (missing.length > 0) {
    throw new HttpError(400, `Unknown product: ${missing.map((e) => e.productId).join(', ')}`);
  }

  const inactive = input.products.filter((entry) => byId.get(entry.productId)!.active === false);
  if (inactive.length > 0) {
    const names = inactive.map((entry) => byId.get(entry.productId)!.name);
    throw new HttpError(400, `These products are deactivated: ${names.join(', ')}`);
  }
}

/** `productIds` is a flat mirror of `products[].productId`, for array-contains queries. */
function writeShape(input: CampaignInput) {
  return {
    ...input,
    description: input.description ?? '',
    productIds: input.products.map((entry) => entry.productId),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

export async function listCampaigns(status?: CampaignStatus): Promise<Campaign[]> {
  const collection = firestore.collection(COLLECTION);
  const snapshot = await (status ? collection.where('status', '==', status) : collection)
    .orderBy('createdAt', 'desc')
    .get();

  return snapshot.docs.map((doc) => toCampaign(doc.id, doc.data()));
}

/** Campaigns a given user has been assigned to. */
export async function listCampaignsForUser(uid: string): Promise<Campaign[]> {
  const snapshot = await firestore
    .collection(COLLECTION)
    .where('status', '==', 'active')
    .where('participantUids', 'array-contains', uid)
    .get();

  return snapshot.docs.map((doc) => toCampaign(doc.id, doc.data()));
}

export async function getCampaign(id: string): Promise<Campaign> {
  const doc = await firestore.collection(COLLECTION).doc(id).get();
  if (!doc.exists) throw new HttpError(404, 'Campaign not found');
  return toCampaign(doc.id, doc.data()!);
}

export async function createCampaign(input: CampaignInput, createdBy: string): Promise<Campaign> {
  await assertProductsExist(input);

  const ref = await firestore.collection(COLLECTION).add({
    ...writeShape(input),
    status: 'draft' satisfies CampaignStatus,
    createdBy,
    createdAt: FieldValue.serverTimestamp(),
  });

  return getCampaign(ref.id);
}

export async function updateCampaign(id: string, input: CampaignInput): Promise<Campaign> {
  const existing = await getCampaign(id);

  if (existing.status === 'archived') {
    throw new HttpError(409, 'Archived campaigns are read-only');
  }

  await assertProductsExist(input);
  await firestore.collection(COLLECTION).doc(id).update(writeShape(input));

  return getCampaign(id);
}

export async function setCampaignStatus(id: string, status: CampaignStatus): Promise<Campaign> {
  const campaign = await getCampaign(id);

  if (status === 'active') {
    const problems = assertActivatable(campaign);
    if (problems.length > 0) {
      throw new HttpError(409, `This campaign is not ready to run: ${problems.join('; ')}`);
    }
  }

  await firestore
    .collection(COLLECTION)
    .doc(id)
    .update({ status, updatedAt: FieldValue.serverTimestamp() });

  return getCampaign(id);
}

export async function deleteCampaign(id: string): Promise<void> {
  const campaign = await getCampaign(id);

  if (campaign.status === 'active') {
    throw new HttpError(409, 'Archive the campaign before deleting it');
  }

  await firestore.collection(COLLECTION).doc(id).delete();
}
