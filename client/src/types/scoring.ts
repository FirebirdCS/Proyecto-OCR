/** Mirrors server/src/types/scoring.ts — keep the two in sync. */
import type { Milestone } from './campaigns';

export interface ScoredLine {
  productId: string;
  productName: string;
  quantity: number;
  /** The campaign's per-unit value at the time of the scan. */
  pointsPerUnit: number;
  points: number;
}

export interface CampaignScore {
  campaignId: string;
  campaignName: string;
  lines: ScoredLine[];
  pointsAwarded: number;
  /** The participant's running total in this campaign after this receipt. */
  totalPoints: number;
  milestone: Milestone | null;
  /** Set only when this receipt is what cleared the milestone. */
  newMilestone: Milestone | null;
  requirementsMet: boolean;
}

export const RECEIPT_ISSUE_CODES = [
  'no_total',
  'no_date',
  'date_outside_campaign',
  'unpriced_products',
  'units_capped',
] as const;
export type ReceiptIssueCode = (typeof RECEIPT_ISSUE_CODES)[number];

/** Blocking: the receipt earned nothing. Otherwise only the lines it names were dropped. */
export interface ReceiptIssue {
  code: ReceiptIssueCode;
  blocking: boolean;
  /** The out-of-range date (`YYYY-MM-DD`), the unpriced products, or the unit cap. */
  detail?: string;
}

/** Why an admin should look at a scan that did earn points. Flags never change the score. */
export const SCAN_FLAG_CODES = [
  'units_capped',
  'large_line_quantity',
  'frequent_scanner',
  'file_not_stored',
] as const;
export type ScanFlag = (typeof SCAN_FLAG_CODES)[number];

export type ScanStatus = 'scored' | 'unscored' | 'voided';

/** One scan as the admin review screen sees it. */
export interface ScanRecord {
  id: string;
  ownerUid: string;
  ownerEmail: string | null;
  ownerName: string | null;
  filename: string;
  text: string;
  status: ScanStatus;
  campaignId: string | null;
  campaignName: string | null;
  pointsAwarded: number;
  campaign: CampaignScore | null;
  issues: ReceiptIssue[];
  flags: ScanFlag[];
  receiptDate: string | null;
  hasFile: boolean;
  contentType: string | null;
  voided: { at: string | null; by: string; reason: string } | null;
  createdAt: string | null;
}

export interface ScanScoring {
  campaignId: string;
  campaignName: string;
  pointsAwarded: number;
  /** Null when nothing counted; `issues` says why, when something blocked it. */
  campaign: CampaignScore | null;
  issues: ReceiptIssue[];
  /** The printed date that placed the receipt inside the campaign window. */
  receiptDate: string | null;
}

export interface CampaignProgress {
  campaignId: string;
  points: number;
  /** Cumulative units per productId. */
  units: Record<string, number>;
  milestoneId: string | null;
  requirementsMet: boolean;
  receipts: number;
  updatedAt: string | null;
}

export interface SalesBucket {
  /** `YYYY-MM-DD` for days and weeks (the Monday), `YYYY-MM` for months. */
  key: string;
  units: number;
  points: number;
  receipts: number;
}

export interface TopProduct {
  productId: string;
  name: string;
  units: number;
  points: number;
}

export type SalesGranularity = 'daily' | 'weekly' | 'monthly';

export interface DashboardStats {
  timeZone: string;
  generatedAt: string;
  products: { total: number; active: number };
  activeCampaigns: number;
  /** Last 30 days, last 12 weeks, last 12 months — oldest first, gaps filled with zeros. */
  series: Record<SalesGranularity, SalesBucket[]>;
  /** Best sellers over the same window as the matching series. */
  topProducts: Record<SalesGranularity, TopProduct[]>;
}
