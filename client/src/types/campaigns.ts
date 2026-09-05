/** Mirrors server/src/types/campaigns.ts — keep the two in sync. */

export const CAMPAIGN_STATUSES = ['draft', 'active', 'archived'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export interface Product {
  id: string;
  name: string;
  sku?: string;
  /** What one unit is worth by default. */
  points: number;
  active: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CampaignProduct {
  productId: string;
  /** Points per unit inside this campaign; may differ from the product default. */
  points: number;
  required: boolean;
  minQuantity: number;
}

export interface Milestone {
  id: string;
  name: string;
  /** Points one user must reach on their own to clear this milestone. */
  targetPoints: number;
  reward?: string;
}

export interface Campaign {
  id: string;
  name: string;
  description: string;
  status: CampaignStatus;
  startsAt: string;
  endsAt: string;
  products: CampaignProduct[];
  milestones: Milestone[];
  participantUids: string[];
  createdBy: string;
  createdAt: string | null;
  updatedAt: string | null;
}

/** The editable half of a campaign — what POST and PUT accept. */
export type CampaignInput = Pick<
  Campaign,
  'name' | 'description' | 'startsAt' | 'endsAt' | 'products' | 'milestones' | 'participantUids'
>;

/** Mirrors the server check that gates draft -> active. */
export function activationProblems(campaign: Pick<CampaignInput, 'products' | 'milestones'>): string[] {
  const problems: string[] = [];
  if (campaign.products.length === 0) problems.push('Agrega al menos un producto');
  if (campaign.milestones.length === 0) problems.push('Agrega al menos un hito');
  return problems;
}
