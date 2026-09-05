/**
 * Creates an account from the terminal. This is how the very first admin comes
 * into existence, since there is no public sign-up page and the admin panel
 * needs an admin to reach it:
 *
 *   pnpm user:create you@example.com admin "Your Name"
 *   pnpm user:create teammate@example.com user
 *
 * Needs the same service-account credentials as the server. Prints the invite
 * link, and emails it too when SMTP is configured.
 */
import { createUserAccount } from '../services/users.service.js';
import { ROLES, isRole } from '../types/roles.js';

const [email, role = 'user', displayName] = process.argv.slice(2);

if (!email || !isRole(role)) {
  console.error(`Usage: pnpm user:create <email> [${ROLES.join('|')}] [display name]`);
  process.exit(1);
}

try {
  const result = await createUserAccount({ email, role, displayName }, 'cli');

  console.log(`Created ${result.profile.email} (${result.profile.uid}) as "${result.profile.role}".`);
  console.log(
    result.invited
      ? 'An invite email is on its way.'
      : 'SMTP is not configured, so no email was sent. Send them this link:',
  );
  console.log(result.inviteLink);
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
