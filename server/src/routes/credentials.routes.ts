import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { sendCredentialsEmail } from '../services/credentials.service.js';

export const credentialsRouter = Router();

credentialsRouter.use(requireAuth, requireAdmin);

const sendSchema = z.object({
  nombre: z.string().trim().min(1).max(120),
  email: z.string().trim().email(),
  usuario: z.string().trim().min(1).max(120),
});

/** POST /api/enviar-credenciales */
credentialsRouter.post('/', async (req, res, next) => {
  try {
    const payload = sendSchema.parse(req.body);
    await sendCredentialsEmail(payload);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
