import { Router } from 'express';
import { requireAdmin, requireAuth } from '../../middleware/auth.js';
import { adminUsersRouter } from './users.routes.js';
import { adminProductsRouter } from './products.routes.js';
import { adminCampaignsRouter } from './campaigns.routes.js';

export const adminRouter = Router();

// Everything mounted below this line is admin-only.
adminRouter.use(requireAuth, requireAdmin);

adminRouter.use('/users', adminUsersRouter);
adminRouter.use('/products', adminProductsRouter);
adminRouter.use('/campaigns', adminCampaignsRouter);
