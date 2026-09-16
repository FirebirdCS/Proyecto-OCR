import { Router } from 'express';
import { getDashboardStats } from '../../services/stats.service.js';

export const adminDashboardRouter = Router();

/** GET /api/admin/dashboard — catalog size and sales per day, week and month. */
adminDashboardRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await getDashboardStats());
  } catch (error) {
    next(error);
  }
});
