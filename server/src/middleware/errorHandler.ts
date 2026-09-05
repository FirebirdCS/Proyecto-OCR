import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../utils/httpError.js';
import { isProduction } from '../config/env.js';

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  // Express identifies error handlers by arity, so `next` must stay in the signature.
  _next: NextFunction,
): void {
  if (error instanceof ZodError) {
    res.status(400).json({ error: 'Validation failed', details: error.flatten() });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, details: error.details });
    return;
  }

  console.error(error);
  res.status(500).json({
    error: 'Internal server error',
    ...(isProduction ? {} : { details: error instanceof Error ? error.message : String(error) }),
  });
}
