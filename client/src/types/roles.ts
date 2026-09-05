/** Mirrors server/src/types/roles.ts — keep the two in sync. */
export const ROLES = ['admin', 'user'] as const;

export type Role = (typeof ROLES)[number];

export const DEFAULT_ROLE: Role = 'user';

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
