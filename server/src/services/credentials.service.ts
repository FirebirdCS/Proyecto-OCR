import { auth } from '../config/firebase.js';
import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';
import { credentialsTemplate } from './mail.templates.js';
import { sendResendMail } from './resend.service.js';

export interface SendCredentialsInput {
  nombre: string;
  email: string;
  usuario: string;
}

/**
 * Emails the assigned username plus a one-time password-set link — never a
 * password itself, matching the project's "no password ever emailed" rule
 * (see createUserAccount / inviteTemplate). Requires the account to already
 * exist; this endpoint only notifies, it does not provision accounts.
 */
export async function sendCredentialsEmail(input: SendCredentialsInput): Promise<void> {
  const email = input.email.trim().toLowerCase();

  const record = await auth.getUserByEmail(email).catch(() => null);
  if (!record) {
    throw new HttpError(404, `No account exists for ${email}`);
  }

  const actionLink = await auth.generatePasswordResetLink(email, {
    url: `${env.CLIENT_ORIGIN}/login`,
    handleCodeInApp: false,
  });

  const { subject, html } = credentialsTemplate({
    nombre: input.nombre,
    usuario: input.usuario,
    actionLink,
  });

  await sendResendMail({ to: email, subject, html });
}
