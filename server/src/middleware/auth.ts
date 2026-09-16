import type { NextFunction, Request, Response } from 'express';
import { auth } from '../config/firebase.js';
import { isProduction } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';
import { DEFAULT_ROLE, ROLE_CLAIM, isRole, type Role } from '../types/roles.js';

export interface AuthenticatedUser {
  uid: string;
  email?: string;
  emailVerified: boolean;
  role: Role;
  claims: Record<string, unknown>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/** Verifies the `Authorization: Bearer <Firebase ID token>` header. */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const header = req.header('authorization') ?? '';
    const [scheme, token] = header.split(' ');

    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new HttpError(401, 'Missing bearer token');
    }

    const decoded = await auth.verifyIdToken(token);
    const claimed = decoded[ROLE_CLAIM];

    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.email_verified ?? false,
      // An account with no claim yet is a plain user until /api/me provisions it.
      role: isRole(claimed) ? claimed : DEFAULT_ROLE,
      claims: decoded,
    };
    next();
  } catch (error) {
    if (error instanceof HttpError) {
      next(error);
      return;
    }
    // The client only ever sees a generic 401, which also hides server-side
    // misconfiguration (missing credentials, wrong project). Say which in dev.
    if (!isProduction) {
      console.warn('[requireAuth] verifyIdToken failed:', (error as Error).message);
    }
    next(new HttpError(401, 'Invalid or expired token'));
  }
}

/** Restricts a route to the listed roles. Use after requireAuth. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new HttpError(401, 'Not authenticated'));
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new HttpError(403, `Requires one of: ${roles.join(', ')}`));
      return;
    }
    next();
  };
}

export const requireAdmin = requireRole('admin');

/** Allows admins through, or the owner of the resource identified by `param`. */
export function requireSelfOrAdmin(param = 'uid') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new HttpError(401, 'Not authenticated'));
      return;
    }
    if (req.user.role === 'admin' || req.user.uid === req.params[param]) {
      next();
      return;
    }
    next(new HttpError(403, 'Not allowed'));
  };
}
