import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getProgressForUser, listCampaignsForUser } from '../services/campaigns.service.js';
import { getProductsByIds } from '../services/products.service.js';

export const campaignsRouter = Router();

campaignsRouter.use(requireAuth);

/**
 * GET /api/campaigns returns the active campaigns the caller is assigned to,
 * where they stand in each, and the names of the products that score — users
 * cannot read the admin product list, but need to know what to sell.
 */
campaignsRouter.get('/', async (req, res, next) => {
  try {
    const campaigns = await listCampaignsForUser(req.user!.uid);
    const productIds = [...new Set(campaigns.flatMap((campaign) => campaign.products.map((entry) => entry.productId)))];

    const [progress, products] = await Promise.all([
      getProgressForUser(
        req.user!.uid,
        campaigns.map((campaign) => campaign.id),
      ),
      getProductsByIds(productIds),
    ]);

    res.json({
      campaigns,
      progress,
      productNames: Object.fromEntries([...products.values()].map((product) => [product.id, product.name])),
    });
  } catch (error) {
    next(error);
  }
});
