import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { env } from '../config/env.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { HttpError } from '../utils/httpError.js';
import { extractText } from '../services/ocr.service.js';
import { listDocuments } from '../services/documents.service.js';
import {
  assertCanScan,
  assertReceiptIsNew,
  assertUnderDailyLimit,
  fingerprint,
  scanReceipt,
} from '../services/scoring.service.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.OCR_MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/tiff', 'application/pdf'];
    cb(null, allowed.includes(file.mimetype));
  },
});

export const ocrRouter = Router();

ocrRouter.use(requireAuth);

/** The campaign the receipt is filed under travels as a form field next to the file. */
const scanBody = z.object({ campaignId: z.string().trim().min(1) });

/**
 * POST /api/ocr — multipart/form-data with a `file` and a `campaignId`. Checks
 * the caller may score in that campaign, extracts the text, then scores it
 * against that campaign only.
 *
 * Only `user` accounts scan: points belong to participants, and an admin who
 * could score receipts could also award themselves the rewards they define.
 * The role check runs before multer so a refused upload is never buffered.
 */
ocrRouter.post('/', requireRole('user'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      throw new HttpError(400, 'Expected a file upload in the "file" field');
    }

    const { campaignId } = scanBody.parse(req.body);
    const campaign = await assertCanScan(req.user!.uid, campaignId);
    const recentScans = await assertUnderDailyLimit(req.user!.uid);

    const fileHash = fingerprint(req.file.buffer);
    await assertReceiptIsNew(fileHash);

    const result = await extractText(req.file.buffer, req.file.mimetype);
    const { documentId, scoring } = await scanReceipt({
      ownerUid: req.user!.uid,
      filename: req.file.originalname,
      fileHash,
      file: { buffer: req.file.buffer, contentType: req.file.mimetype },
      result,
      campaign,
      recentScans,
    });

    res.status(201).json({ documentId, ...result, scoring });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/ocr/documents — the caller's OCR history.
 * Admins may pass ?ownerUid=<uid> to read someone else's.
 */
ocrRouter.get('/documents', async (req, res, next) => {
  try {
    const requested = typeof req.query.ownerUid === 'string' ? req.query.ownerUid : null;

    if (requested && requested !== req.user!.uid && req.user!.role !== 'admin') {
      throw new HttpError(403, "Only admins can read another user's documents");
    }

    res.json({ documents: await listDocuments(requested ?? req.user!.uid) });
  } catch (error) {
    next(error);
  }
});
