/** Initials for an avatar — from a display name, falling back to the email's local part. */
export function getInitials(name: string | null | undefined, email: string | null | undefined): string {
  const source = name?.trim() || email?.split('@')[0] || '';
  if (!source) return '?';

  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0]!.toUpperCase());
  return letters.join('') || '?';
}
