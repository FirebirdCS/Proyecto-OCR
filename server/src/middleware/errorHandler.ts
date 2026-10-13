import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../utils/httpError.js';
import { validationMessage } from '../utils/validationMessage.js';
import { isProduction } from '../config/env.js';

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
