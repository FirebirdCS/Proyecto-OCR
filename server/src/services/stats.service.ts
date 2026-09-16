import { FieldValue, type QueryDocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import { firestore } from '../config/firebase.js';
import {
  STATS_TIME_ZONE,
  addDays,
  addMonths,
  dayKey,
  monthOf,
  weekStart,
} from '../utils/calendar.js';
import type {
  DashboardStats,
  SalesBucket,
  SalesGranularity,
  TopProduct,
} from '../types/scoring.js';
import { countProducts } from './products.service.js';
import { countCampaigns } from './campaigns.service.js';

/**
 * One document per calendar day, incremented as receipts are scored. The
 * dashboard then reads at most a year of small documents instead of scanning
 * every receipt ever uploaded.
 */
const COLLECTION = 'salesDaily';

const DAYS = 30;
const WEEKS = 12;
const MONTHS = 12;
const TOP_PRODUCTS = 8;

export interface DailySale {
  productId: string;
  name: string;
  units: number;
  points: number;
}

function applyDailySales(tx: Transaction, at: Date, sales: DailySale[], sign: 1 | -1): void {
  const date = dayKey(at);

  tx.set(
    firestore.collection(COLLECTION).doc(date),
    {
      date,
      units: FieldValue.increment(sign * sales.reduce((sum, sale) => sum + sale.units, 0)),
      points: FieldValue.increment(sign * sales.reduce((sum, sale) => sum + sale.points, 0)),
      receipts: FieldValue.increment(sign),
      products: Object.fromEntries(
        sales.map((sale) => [
          sale.productId,
          {
            // Kept so a product deleted later still has a name in old stats.
            name: sale.name,
            units: FieldValue.increment(sign * sale.units),
            points: FieldValue.increment(sign * sale.points),
          },
        ]),
      ),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

/** Adds one scored receipt to its day's totals. Runs inside the scan transaction. */
export function recordDailySales(tx: Transaction, at: Date, sales: DailySale[]): void {
  applyDailySales(tx, at, sales, 1);
}

/** Takes a voided receipt back out of the day it was scanned on. */
export function reverseDailySales(tx: Transaction, at: Date, sales: DailySale[]): void {
  applyDailySales(tx, at, sales, -1);
}

function summarize(
  days: QueryDocumentSnapshot[],
  keys: string[],
  bucketOf: (day: string) => string,
): { series: SalesBucket[]; top: TopProduct[] } {
  const buckets = new Map(keys.map((key) => [key, { key, units: 0, points: 0, receipts: 0 }]));
  const top = new Map<string, TopProduct>();

  for (const day of days) {
    const data = day.data();
    const bucket = buckets.get(bucketOf(data.date));
    if (!bucket) continue;

    bucket.units += data.units ?? 0;
    bucket.points += data.points ?? 0;
    bucket.receipts += data.receipts ?? 0;

    for (const [productId, entry] of Object.entries<{ name?: string; units?: number; points?: number }>(
      data.products ?? {},
    )) {
      const total = top.get(productId) ?? { productId, name: '', units: 0, points: 0 };
      // Days arrive oldest first, so the most recent name wins.
      total.name = entry.name ?? total.name;
      total.units += entry.units ?? 0;
      total.points += entry.points ?? 0;
      top.set(productId, total);
    }
  }

  return {
    series: [...buckets.values()],
    top: [...top.values()]
      .sort((a, b) => b.units - a.units || b.points - a.points)
      .slice(0, TOP_PRODUCTS),
  };
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const now = new Date();
  const today = dayKey(now);
  const thisWeek = weekStart(today);

  const windows: Record<SalesGranularity, { keys: string[]; bucketOf: (day: string) => string }> = {
    daily: {
      keys: Array.from({ length: DAYS }, (_, index) => addDays(today, index - (DAYS - 1))),
      bucketOf: (day) => day,
    },
    weekly: {
      keys: Array.from({ length: WEEKS }, (_, index) => addDays(thisWeek, (index - (WEEKS - 1)) * 7)),
      bucketOf: weekStart,
    },
    monthly: {
      keys: Array.from({ length: MONTHS }, (_, index) => addMonths(monthOf(today), index - (MONTHS - 1))),
      bucketOf: monthOf,
    },
  };

  const from = [windows.daily.keys[0]!, windows.weekly.keys[0]!, `${windows.monthly.keys[0]}-01`].sort()[0]!;

  const [products, activeCampaigns, snapshot] = await Promise.all([
    countProducts(),
    countCampaigns('active'),
    firestore
      .collection(COLLECTION)
      .where('date', '>=', from)
      .where('date', '<=', today)
      .orderBy('date')
      .get(),
  ]);

  const daily = summarize(snapshot.docs, windows.daily.keys, windows.daily.bucketOf);
  const weekly = summarize(snapshot.docs, windows.weekly.keys, windows.weekly.bucketOf);
  const monthly = summarize(snapshot.docs, windows.monthly.keys, windows.monthly.bucketOf);

  return {
    timeZone: STATS_TIME_ZONE,
    generatedAt: now.toISOString(),
    products,
    activeCampaigns,
    series: { daily: daily.series, weekly: weekly.series, monthly: monthly.series },
    topProducts: { daily: daily.top, weekly: weekly.top, monthly: monthly.top },
  };
}
