import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../../utils/httpError.js';
import { getScan, getScanFilePath, listScans } from '../../services/documents.service.js';
import { signedReceiptUrl } from '../../services/receiptFiles.service.js';
import { voidScan } from '../../services/scoring.service.js';

export const adminScansRouter = Router();

const listQuery = z.object({
  flagged: z.enum(['true', 'false']).optional(),
  before: z.string().datetime().optional(),
});

/** GET /api/admin/scans — newest first; ?flagged=true for the review queue, ?before= to page. */
adminScansRouter.get('/', async (req, res, next) => {
  try {
    const { flagged, before } = listQuery.parse(req.query);
    res.json(await listScans({ flaggedOnly: flagged === 'true', before }));
  } catch (error) {
    next(error);
  }
});

/** GET /api/admin/scans/:id/file — a link to the stored receipt, valid for a few minutes. */
adminScansRouter.get('/:id/file', async (req, res, next) => {
  try {
    const path = await getScanFilePath(req.params.id!);
    if (!path) throw new HttpError(404, 'No se guardó el archivo de este comprobante');
    res.json({ url: await signedReceiptUrl(path) });
  } catch (error) {
    next(error);
  }
});

const voidBody = z.object({ reason: z.string().trim().min(3).max(300) });

/** POST /api/admin/scans/:id/void takes the scan's points back. A reason is required. */
adminScansRouter.post('/:id/void', async (req, res, next) => {
  try {
    const { reason } = voidBody.parse(req.body);
    await voidScan(req.params.id!, req.user!.uid, reason);
    res.json(await getScan(req.params.id!));
  } catch (error) {
    next(error);
  }
});
