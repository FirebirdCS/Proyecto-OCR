import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { HttpError } from '../utils/httpError.js';
import { validationMessage } from '../utils/validationMessage.js';
import { env, isProduction } from '../config/env.js';

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'No encontrado' });
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  // Express identifies error handlers by arity, so `next` must stay in the signature.
  _next: NextFunction,
): void {
  if (error instanceof ZodError) {
    res.status(400).json({ error: validationMessage(error), details: error.flatten() });
    return;
  }

  // multer's own errors used to fall through to the 500 below.
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        error: `El archivo supera el máximo de ${env.OCR_MAX_UPLOAD_MB} MB.`,
        details: { code: 'file_too_large', maxMb: env.OCR_MAX_UPLOAD_MB },
      });
      return;
    }
    res.status(400).json({ error: 'La subida no es válida. Envía un solo archivo en el campo «file».' });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, details: error.details });
    return;
  }

  // Firestore's FAILED_PRECONDITION is almost always a composite index that
  // firestore.indexes.json declares but nobody has deployed yet.
  if ((error as { code?: unknown }).code === 9) {
    console.error('[firestore] missing index:', (error as Error).message);
    res.status(503).json({
      error: 'Falta un índice de Firestore. Despliega firestore.indexes.json (firebase deploy --only firestore:indexes).',
    });
    return;
  }

  console.error(error);
  res.status(500).json({
    error: 'Error interno del servidor',
    ...(isProduction ? {} : { details: error instanceof Error ? error.message : String(error) }),
  });
}
