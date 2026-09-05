/**
 * Bootstraps the first admin, or fixes a role from the terminal:
 *
 *   pnpm role:grant someone@example.com admin
 *   pnpm role:grant someone@example.com user
 *
 * Needs the same service-account credentials as the server.
 */
import { setRoleByEmail } from '../services/users.service.js';
import { ROLES, isRole } from '../types/roles.js';

const [email, role] = process.argv.slice(2);

if (!email || !isRole(role)) {
  console.error(`Usage: pnpm role:grant <email> <${ROLES.join('|')}>`);
  process.exit(1);
}

try {
  const profile = await setRoleByEmail(email, role);
  console.log(`${profile.email} (${profile.uid}) is now "${profile.role}".`);
  console.log('Their next token refresh picks it up — sign out and back in to see it now.');
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
