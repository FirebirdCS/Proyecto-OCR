/**
 * The project has exactly two roles. `user` is what every account gets on first
 * sign-in; `admin` is granted deliberately, either by another admin through the
 * API or by the `role:grant` script.
 */
export const ROLES = ['admin', 'user'] as const;

export type Role = (typeof ROLES)[number];

export const DEFAULT_ROLE: Role = 'user';

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** Roles are stored in the Firebase ID token under this custom claim. */
export const ROLE_CLAIM = 'role';
