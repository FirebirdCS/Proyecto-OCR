import { z } from 'zod';

/**
 * A campaign is a set of rules an admin writes: which products count, what each
 * one is worth in points, and the milestones every assigned user has to reach
 * on their own. Progress is tracked per user against the same milestone ladder.
 */
export const CAMPAIGN_STATUSES = ['draft', 'active', 'archived'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/* ------------------------------------------------------------------ products */

export const productInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sku: z.string().trim().max(60).optional(),
  /** Base worth of one unit. A campaign may override it. */
  points: z.number().int().min(0).max(1_000_000),
  active: z.boolean().default(true),
});

export type ProductInput = z.infer<typeof productInputSchema>;

export interface Product extends ProductInput {
  id: string;
  createdAt: string | null;
  updatedAt: string | null;
}

/* ----------------------------------------------------------------- campaigns */

const campaignProductSchema = z.object({
  productId: z.string().min(1),
  /** Points per unit inside this campaign; falls back to the product's own. */
  points: z.number().int().min(0).max(1_000_000),
  /** Required products must all be sold before the campaign counts as complete. */
  required: z.boolean().default(false),
  /** Minimum units of this product, only meaningful when `required`. */
  minQuantity: z.number().int().min(0).max(1_000_000).default(0),
});

const milestoneSchema = z.object({
  id: z.string().min(1).max(60),
  name: z.string().trim().min(1).max(120),
  /** Points one user must accumulate to clear this milestone. */
  targetPoints: z.number().int().min(1).max(10_000_000),
  reward: z.string().trim().max(200).optional(),
});

export const campaignInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).optional(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    products: z.array(campaignProductSchema).default([]),
    milestones: z.array(milestoneSchema).default([]),
    /** Users the milestones apply to. Each one is measured individually. */
    participantUids: z.array(z.string().min(1)).default([]),
  })
  .superRefine((campaign, ctx) => {
    if (Date.parse(campaign.endsAt) <= Date.parse(campaign.startsAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endsAt'],
        message: 'The campaign must end after it starts',
      });
    }

    const productIds = campaign.products.map((entry) => entry.productId);
    if (new Set(productIds).size !== productIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['products'],
        message: 'A product can only appear once in a campaign',
      });
    }

    const milestoneIds = campaign.milestones.map((entry) => entry.id);
    if (new Set(milestoneIds).size !== milestoneIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['milestones'],
        message: 'Milestone ids must be unique',
      });
    }

    // Milestones are a ladder: each rung has to sit above the one below it, or
    // clearing one would silently clear another.
    const targets = campaign.milestones.map((entry) => entry.targetPoints);
    const ascending = targets.every((value, index) => index === 0 || value > targets[index - 1]!);
    if (!ascending) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['milestones'],
        message: 'Milestone targets must increase from one milestone to the next',
      });
    }

    for (const [index, entry] of campaign.products.entries()) {
      if (entry.required && entry.minQuantity < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['products', index, 'minQuantity'],
          message: 'A required product needs a minimum quantity of at least 1',
        });
      }
    }
  });

export type CampaignInput = z.infer<typeof campaignInputSchema>;
export type CampaignProduct = z.infer<typeof campaignProductSchema>;
export type Milestone = z.infer<typeof milestoneSchema>;

export interface Campaign extends Omit<CampaignInput, 'description'> {
  id: string;
  description: string;
  status: CampaignStatus;
  createdBy: string;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * A campaign can only leave `draft` once its rules are complete — otherwise
 * users would be assigned to a goal nobody can score against.
 */
export function assertActivatable(campaign: Pick<Campaign, 'products' | 'milestones'>): string[] {
  const problems: string[] = [];
  if (campaign.products.length === 0) problems.push('Add at least one product');
  if (campaign.milestones.length === 0) problems.push('Add at least one milestone');
  return problems;
}

/** Highest milestone a given point total clears, or null below the first rung. */
export function milestoneReached(milestones: Milestone[], points: number): Milestone | null {
  const sorted = [...milestones].sort((a, b) => a.targetPoints - b.targetPoints);
  let reached: Milestone | null = null;
  for (const milestone of sorted) {
    if (points >= milestone.targetPoints) reached = milestone;
  }
  return reached;
}

/** Whether every required product has reached its minimum quantity. */
export function requirementsMet(
  products: CampaignProduct[],
  units: Record<string, number>,
): boolean {
  return products.every((entry) => !entry.required || (units[entry.productId] ?? 0) >= entry.minQuantity);
}
