import { Router } from 'express';
import { z } from 'zod';
import {
  createCampaign,
  deleteCampaign,
  getCampaign,
  listCampaigns,
  setCampaignStatus,
  updateCampaign,
} from '../../services/campaigns.service.js';
import { CAMPAIGN_STATUSES, campaignInputSchema } from '../../types/campaigns.js';

export const adminCampaignsRouter = Router();

const listQuery = z.object({ status: z.enum(CAMPAIGN_STATUSES).optional() });

/** GET /api/admin/campaigns */
adminCampaignsRouter.get('/', async (req, res, next) => {
  try {
    const { status } = listQuery.parse(req.query);
    res.json({ campaigns: await listCampaigns(status) });
  } catch (error) {
    next(error);
  }
});

/** GET /api/admin/campaigns/:id */
adminCampaignsRouter.get('/:id', async (req, res, next) => {
  try {
    res.json(await getCampaign(req.params.id!));
  } catch (error) {
    next(error);
  }
});

/** POST /api/admin/campaigns always lands in draft. */
adminCampaignsRouter.post('/', async (req, res, next) => {
  try {
    const input = campaignInputSchema.parse(req.body);
    res.status(201).json(await createCampaign(input, req.user!.uid));
  } catch (error) {
    next(error);
  }
});

/** PUT /api/admin/campaigns/:id replaces the whole rule set at once. */
adminCampaignsRouter.put('/:id', async (req, res, next) => {
  try {
    const input = campaignInputSchema.parse(req.body);
    res.json(await updateCampaign(req.params.id!, input));
  } catch (error) {
    next(error);
  }
});

const statusBody = z.object({ status: z.enum(CAMPAIGN_STATUSES) });

/** PATCH /api/admin/campaigns/:id/status moves draft to active to archived. */
adminCampaignsRouter.patch('/:id/status', async (req, res, next) => {
  try {
    const { status } = statusBody.parse(req.body);
    res.json(await setCampaignStatus(req.params.id!, status));
  } catch (error) {
    next(error);
  }
});

/** DELETE /api/admin/campaigns/:id */
adminCampaignsRouter.delete('/:id', async (req, res, next) => {
  try {
    await deleteCampaign(req.params.id!);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
