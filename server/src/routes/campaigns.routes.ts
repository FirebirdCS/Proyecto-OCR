import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { listCampaignsForUser } from '../services/campaigns.service.js';

export const campaignsRouter = Router();

campaignsRouter.use(requireAuth);

/** GET /api/campaigns returns the active campaigns the caller is assigned to. */
campaignsRouter.get('/', async (req, res, next) => {
  try {
    res.json({ campaigns: await listCampaignsForUser(req.user!.uid) });
  } catch (error) {
    next(error);
  }
});
