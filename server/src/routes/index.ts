import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { ensureUserProfile } from '../services/users.service.js';
import { ocrRouter } from './ocr.routes.js';
import { mailRouter } from './mail.routes.js';
import { adminRouter } from './admin/index.js';
import { campaignsRouter } from './campaigns.routes.js';
import { credentialsRouter } from './credentials.routes.js';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

/**
 * The client calls this right after sign-in. It provisions the Firestore
 * profile and the role claim for new accounts, then returns the effective role.
 * If the returned role differs from the one in the client's cached token, the
 * client refreshes the token.
 */
apiRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    res.json(await ensureUserProfile(req.user!.uid));
  } catch (error) {
    next(error);
  }
});

apiRouter.use('/ocr', ocrRouter);
apiRouter.use('/mail', mailRouter);
apiRouter.use('/campaigns', campaignsRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/enviar-credenciales', credentialsRouter);
