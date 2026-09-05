import { Router } from 'express';
import multer from 'multer';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { HttpError } from '../utils/httpError.js';
import { extractTextFromImage } from '../services/ocr.service.js';
import { listDocuments, saveDocument } from '../services/documents.service.js';

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

/** POST /api/ocr — multipart/form-data with a single `file` field. */
ocrRouter.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      throw new HttpError(400, 'Expected a file upload in the "file" field');
    }

    const result = await extractTextFromImage(req.file.buffer);
    const documentId = await saveDocument({
      ownerUid: req.user!.uid,
      filename: req.file.originalname,
      result,
    });

    res.status(201).json({ documentId, ...result });
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
