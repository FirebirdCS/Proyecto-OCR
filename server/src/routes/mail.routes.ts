import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { sendMail } from '../services/mail.service.js';

export const mailRouter = Router();

mailRouter.use(requireAuth);

const sendSchema = z
  .object({
    to: z.union([z.string().email(), z.array(z.string().email()).min(1)]),
    subject: z.string().min(1).max(200),
    text: z.string().optional(),
    html: z.string().optional(),
  })
  .refine((value) => value.text || value.html, {
    message: 'Indica el texto o el HTML del correo.',
  });

/** POST /api/mail/send */
mailRouter.post('/send', async (req, res, next) => {
  try {
    const payload = sendSchema.parse(req.body);
    const messageId = await sendMail(payload);
    res.status(202).json({ messageId });
  } catch (error) {
    next(error);
  }
});
