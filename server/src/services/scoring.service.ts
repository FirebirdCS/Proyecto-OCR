import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { env } from '../config/env.js';
import { firestore } from '../config/firebase.js';
import { HttpError } from '../utils/httpError.js';
import { dayKey } from '../utils/calendar.js';
import { matchReceipt, normalizeText } from '../utils/receiptMatching.js';
import {
  findReceiptDates,
  findTicketNumber,
  findTime,
  findTotalCents,
} from '../utils/receiptChecks.js';
import { milestoneReached, requirementsMet, type Campaign } from '../types/campaigns.js';
import type {
  CampaignScore,
  ReceiptIssue,
  ScanFlag,
  ScanScoring,
  ScoredLine,
} from '../types/scoring.js';
import type { OcrResult } from './ocr.service.js';
import { getCampaign, participantRef, toProgress } from './campaigns.service.js';
import { getProductsByIds } from './products.service.js';
import {
  countRecentScans,
  documentRef,
  newDocumentRef,
  scoreOf,
  writeScannedDocument,
} from './documents.service.js';
import { recordDailySales, reverseDailySales } from './stats.service.js';
import { deleteReceiptFile, isFileStorageConfigured, storeReceiptFile } from './receiptFiles.service.js';

/**
 * One document per receipt that has already earned points. Three keys guard
 * each one:
 * - the file hash stops the same upload twice;
 * - the text hash stops the same receipt re-saved or re-exported;
 * - the receipt identity — printed date, total, and ticket number (or time) —
 *   stops a fresh photo of the same paper receipt, from any account.
 */
const GUARDS = 'receiptGuards';

/** Scans in 24 hours after which a user's receipts go to the review queue. */
const FREQUENT_SCANS = 5;
/** A single line counting this many units is more often a misread than a purchase. */
const LARGE_LINE_QUANTITY = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

export const fingerprint = (value: Buffer | string) =>
  createHash('sha256').update(value).digest('hex');

// `details.code` lets the client word each refusal in Spanish.
const duplicateReceipt = () =>
  new HttpError(409, 'Este comprobante ya fue registrado', { code: 'duplicate_receipt' });

/** Cheap early exit, run before paying for a Vision call. The scan re-checks atomically. */
export async function assertReceiptIsNew(fileHash: string): Promise<void> {
  const guard = await firestore.collection(GUARDS).doc(`file-${fileHash}`).get();
  if (guard.exists) throw duplicateReceipt();
}

/**
 * Every scan costs a Vision call whether it scores or not, so the cap counts
 * all of them. Returns how many the user already sent in the last 24 hours.
 */
export async function assertUnderDailyLimit(uid: string): Promise<number> {
  let recent: number;
  try {
    recent = await countRecentScans(uid, new Date(Date.now() - DAY_MS));
  } catch (error) {
    // Firestore's FAILED_PRECONDITION: the composite index is not deployed yet.
    // Scanning must not go down with it; the missing limit is logged loudly.
    if ((error as { code?: number }).code !== 9) throw error;
    console.error('[scans] daily limit NOT enforced — deploy firestore.indexes.json:', (error as Error).message);
    return 0;
  }

  if (recent >= env.SCAN_DAILY_LIMIT) {
    throw new HttpError(429, 'Alcanzaste el límite de comprobantes por día', {
      code: 'daily_limit',
      limit: env.SCAN_DAILY_LIMIT,
    });
  }
  return recent;
}

/** Points only count while the campaign's window is open, judged at scan time. */
function isRunning(campaign: Campaign, now: number): boolean {
  return Date.parse(campaign.startsAt) <= now && now < Date.parse(campaign.endsAt);
}

/**
 * The campaign a scan is filed under has to be one the caller takes part in and
 * that is running right now. Checked before the upload reaches Vision.
 */
export async function assertCanScan(uid: string, campaignId: string, now = new Date()): Promise<Campaign> {
  const campaign = await getCampaign(campaignId);

  if (!campaign.participantUids.includes(uid)) {
    throw new HttpError(403, 'No participas en esta campaña', { code: 'not_participant' });
  }
  if (campaign.status !== 'active' || !isRunning(campaign, now.getTime())) {
    throw new HttpError(409, 'Esta campaña no está vigente', { code: 'campaign_not_running' });
  }

  return campaign;
}

/**
 * Receipt-level checks: a real receipt states its total and when it was issued,
 * and that date has to fall inside the campaign — so an old receipt, or a note
 * that merely names a product, earns nothing.
 */
function inspectReceipt(
  text: string,
  campaign: Campaign,
  now: Date,
): { issues: ReceiptIssue[]; receiptDate: string | null; totalCents: number | null } {
  const issues: ReceiptIssue[] = [];

  const totalCents = findTotalCents(text);
  if (totalCents === null) issues.push({ code: 'no_total', blocking: true });

  const dates = findReceiptDates(text).sort();
  const from = dayKey(new Date(campaign.startsAt));
  // A receipt dated after today is not a receipt yet.
  const to = [dayKey(new Date(campaign.endsAt)), dayKey(now)].sort()[0]!;
  const receiptDate = dates.find((date) => date >= from && date <= to) ?? null;

  if (dates.length === 0) {
    issues.push({ code: 'no_date', blocking: true });
  } else if (!receiptDate) {
    issues.push({ code: 'date_outside_campaign', blocking: true, detail: dates.at(-1)! });
  }

  return { issues, receiptDate, totalCents };
}

/**
 * What makes a paper receipt the same receipt across two photos. The ticket
 * number is preferred; without one, the printed time; without that, what was
 * bought. OCR that misreads one of these digits defeats it — that is what the
 * review queue is for.
 */
function receiptIdentity(
  text: string,
  receiptDate: string,
  totalCents: number,
  lines: ScoredLine[],
): string {
  const ticket = findTicketNumber(text);
  const time = findTime(text);
  const tail = ticket
    ? `ticket:${ticket}`
    : time
      ? `time:${time}`
      : `lines:${lines
          .map((line) => `${line.productId}x${line.quantity}`)
          .sort()
          .join(',')}`;
  return `${receiptDate}|${totalCents}|${tail}`;
}

/** Drops units past the per-receipt cap, first come first counted. */
function capUnits(lines: ScoredLine[], max: number): { lines: ScoredLine[]; capped: boolean } {
  let remaining = max;
  const kept = lines
    .map((line) => {
      const quantity = Math.min(line.quantity, remaining);
      remaining -= quantity;
      return { ...line, quantity, points: quantity * line.pointsPerUnit };
    })
    .filter((line) => line.quantity > 0);

  const before = lines.reduce((sum, line) => sum + line.quantity, 0);
  const after = kept.reduce((sum, line) => sum + line.quantity, 0);
  return { lines: kept, capped: after < before };
}

/**
 * Scores a receipt against the campaign the user filed it under: each product
 * of that campaign found on a priced line is worth `units × points per unit`.
 * The file is stored first so the document can point at it; the document, the
 * participant's total, the duplicate guards and the daily sales stats are then
 * written in one transaction, so a receipt is either fully scored or not at
 * all. Rejected scans are stored too, with their issues.
 */
export async function scanReceipt(input: {
  ownerUid: string;
  filename: string;
  fileHash: string;
  file: { buffer: Buffer; contentType: string };
  result: OcrResult;
  campaign: Campaign;
  /** Scans this user sent in the 24 hours before this one. */
  recentScans: number;
}): Promise<{ documentId: string; scoring: ScanScoring }> {
  const { campaign } = input;
  const now = new Date();
  const text = input.result.lines.length > 0 ? input.result.lines.join('\n') : input.result.text;

  const products = await getProductsByIds(campaign.products.map((entry) => entry.productId));
  // Only this campaign's products are candidates, and a deactivated one never is.
  const matches = matchReceipt(
    text,
    [...products.values()]
      .filter((product) => product.active)
      .map((product) => ({ productId: product.id, name: product.name, sku: product.sku })),
  );

  const { issues, receiptDate, totalCents } = inspectReceipt(text, campaign, now);
  const blocked = issues.some((issue) => issue.blocking);

  const pricedLines = matches.flatMap((match) =>
    match.lines.filter((line) => line.priced).map((line) => ({ ...line, productId: match.productId })),
  );
  const pricedUnits = new Map<string, number>();
  for (const line of pricedLines) {
    pricedUnits.set(line.productId, (pricedUnits.get(line.productId) ?? 0) + line.quantity);
  }

  const unpriced = matches.filter((match) => match.lines.some((line) => !line.priced));
  if (unpriced.length > 0) {
    issues.push({
      code: 'unpriced_products',
      blocking: false,
      detail: unpriced.map((match) => products.get(match.productId)!.name).join(', '),
    });
  }

  const uncapped: ScoredLine[] = blocked
    ? []
    : campaign.products
        .filter((entry) => (pricedUnits.get(entry.productId) ?? 0) > 0)
        .map((entry) => {
          const quantity = pricedUnits.get(entry.productId)!;
          return {
            productId: entry.productId,
            productName: products.get(entry.productId)!.name,
            quantity,
            pointsPerUnit: entry.points,
            points: quantity * entry.points,
          };
        });

  const { lines, capped } = capUnits(uncapped, env.RECEIPT_MAX_UNITS);
  if (capped) {
    issues.push({ code: 'units_capped', blocking: false, detail: String(env.RECEIPT_MAX_UNITS) });
  }
  const scores = lines.length > 0;

  const documentRef = newDocumentRef();
  const filePath = await storeReceiptFile({
    ownerUid: input.ownerUid,
    documentId: documentRef.id,
    buffer: input.file.buffer,
    contentType: input.file.contentType,
  });

  const flags: ScanFlag[] = [];
  if (scores) {
    if (capped) flags.push('units_capped');
    if (pricedLines.some((line) => line.quantity >= LARGE_LINE_QUANTITY)) flags.push('large_line_quantity');
    if (input.recentScans >= FREQUENT_SCANS) flags.push('frequent_scanner');
    if (isFileStorageConfigured() && !filePath) flags.push('file_not_stored');
  }

  // Only receipts that earned something are guarded: a rejected one may be
  // photographed again, better lit, and resubmitted.
  const guardIds = scores
    ? [
        `file-${input.fileHash}`,
        `text-${fingerprint(normalizeText(input.result.text))}`,
        // Scoring requires both a date and a total, so both are known here.
        `receipt-${fingerprint(receiptIdentity(text, receiptDate!, totalCents!, lines))}`,
      ]
    : [];
  const guardRefs = guardIds.map((id) => firestore.collection(GUARDS).doc(id));
  const progressRef = participantRef(campaign.id, input.ownerUid);

  try {
    const scoring = await firestore.runTransaction(async (tx) => {
      const snapshots = scores ? await tx.getAll(...guardRefs, progressRef) : [];
      if (snapshots.slice(0, guardRefs.length).some((snapshot) => snapshot.exists)) {
        throw duplicateReceipt();
      }

      let score: CampaignScore | null = null;

      if (scores) {
        const before = toProgress(campaign.id, snapshots.at(-1)!.data());
        const units = { ...before.units };
        for (const line of lines) units[line.productId] = (units[line.productId] ?? 0) + line.quantity;

        const pointsAwarded = lines.reduce((sum, line) => sum + line.points, 0);
        const totalPoints = before.points + pointsAwarded;
        const milestone = milestoneReached(campaign.milestones, totalPoints);
        const previous = milestoneReached(campaign.milestones, before.points);
        const met = requirementsMet(campaign.products, units);

        tx.set(progressRef, {
          uid: input.ownerUid,
          points: totalPoints,
          units,
          milestoneId: milestone?.id ?? null,
          requirementsMet: met,
          receipts: before.receipts + 1,
          updatedAt: FieldValue.serverTimestamp(),
        });

        score = {
          campaignId: campaign.id,
          campaignName: campaign.name,
          lines,
          pointsAwarded,
          totalPoints,
          milestone,
          newMilestone: milestone && milestone.id !== previous?.id ? milestone : null,
          requirementsMet: met,
        };
      }

      const result: ScanScoring = {
        campaignId: campaign.id,
        campaignName: campaign.name,
        pointsAwarded: score?.pointsAwarded ?? 0,
        campaign: score,
        issues,
        receiptDate,
      };

      writeScannedDocument(tx, documentRef, {
        ownerUid: input.ownerUid,
        filename: input.filename,
        fileHash: input.fileHash,
        filePath,
        contentType: input.file.contentType,
        result: input.result,
        scoring: result,
        flags,
      });

      for (const ref of guardRefs) {
        tx.create(ref, {
          documentId: documentRef.id,
          ownerUid: input.ownerUid,
          createdAt: FieldValue.serverTimestamp(),
        });
      }

      if (score) {
        recordDailySales(
          tx,
          now,
          score.lines.map((line) => ({
            productId: line.productId,
            name: line.productName,
            units: line.quantity,
            points: line.points,
          })),
        );
      }

      return result;
    });

    return { documentId: documentRef.id, scoring };
  } catch (error) {
    // No document points at the file, so nobody could ever review it.
    if (filePath) await deleteReceiptFile(filePath);
    throw error;
  }
}

/**
 * Takes a scan's points back: the participant's total, units, milestone and
 * requirements are recomputed, and the sale leaves the day it was counted on.
 * The duplicate guards stay, so the same receipt cannot simply be sent again.
 */
export async function voidScan(documentId: string, actorUid: string, reason: string): Promise<void> {
  const ref = documentRef(documentId);
  const initial = await ref.get();
  if (!initial.exists) throw new HttpError(404, 'No se encontró el comprobante');

  const initialScore = scoreOf(initial.data()!);
  // Read outside the transaction: only the milestone ladder and required
  // products are needed, and a campaign deleted since still gets its points back.
  const campaign = initialScore ? await getCampaign(initialScore.campaignId).catch(() => null) : null;

  await firestore.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data()!;
    const score = scoreOf(data);

    if (data.status === 'voided') {
      throw new HttpError(409, 'Este comprobante ya está anulado', { code: 'already_voided' });
    }
    if (!score || data.status === 'unscored') {
      throw new HttpError(409, 'Solo se pueden anular comprobantes que sumaron puntos', { code: 'not_scored' });
    }

    const progressRef = participantRef(score.campaignId, data.ownerUid);
    const before = toProgress(score.campaignId, (await tx.get(progressRef)).data());

    const units = { ...before.units };
    for (const line of score.lines) {
      units[line.productId] = Math.max(0, (units[line.productId] ?? 0) - line.quantity);
    }
    const points = Math.max(0, before.points - score.pointsAwarded);
    const milestone = milestoneReached(campaign?.milestones ?? [], points);

    tx.set(progressRef, {
      uid: data.ownerUid,
      points,
      units,
      milestoneId: milestone?.id ?? null,
      requirementsMet: requirementsMet(campaign?.products ?? [], units),
      receipts: Math.max(0, before.receipts - 1),
      updatedAt: FieldValue.serverTimestamp(),
    });

    reverseDailySales(
      tx,
      data.createdAt?.toDate() ?? new Date(),
      score.lines.map((line) => ({
        productId: line.productId,
        name: line.productName,
        units: line.quantity,
        points: line.points,
      })),
    );

    tx.update(ref, {
      status: 'voided',
      voided: { at: FieldValue.serverTimestamp(), by: actorUid, reason },
    });
  });
}
