const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );

export interface InviteTemplateInput {
  appName: string;
  displayName?: string;
  email: string;
  /** One-time link that lets the new user choose their password. */
  actionLink: string;
}

/**
 * The account already exists when this goes out; the link is a password-set
 * link, so the recipient never receives a password by email.
 */
export function inviteTemplate(input: InviteTemplateInput): { subject: string; text: string; html: string } {
  const greeting = input.displayName ? `Hola ${input.displayName},` : 'Hola,';
  const subject = `Tu cuenta de ${input.appName} está lista`;

  const text = [
    greeting,
    '',
    `Se ha creado una cuenta para ti en ${input.appName} usando ${input.email}.`,
    '',
    'Elige una contraseña para activarla:',
    input.actionLink,
    '',
    'El enlace expira, así que si deja de funcionar pide a un administrador que te envíe uno nuevo.',
  ].join('\n');

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f6f7f9;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#16181d;">
    <table role="presentation" style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
      <tr><td>
        <h1 style="margin:0 0 16px;font-size:20px;">Tu cuenta de ${escapeHtml(input.appName)} está lista</h1>
        <p style="margin:0 0 12px;line-height:1.5;">${escapeHtml(greeting)}</p>
        <p style="margin:0 0 20px;line-height:1.5;">
          Se ha creado una cuenta para ti usando
          <strong>${escapeHtml(input.email)}</strong>. Elige una contraseña para activarla.
        </p>
        <p style="margin:0 0 24px;">
          <a href="${escapeHtml(input.actionLink)}"
             style="display:inline-block;padding:12px 20px;background:#3b62f6;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">
            Establecer mi contraseña
          </a>
        </p>
        <p style="margin:0;font-size:13px;color:#5c6270;line-height:1.5;">
          El enlace expira. Si deja de funcionar, pide a un administrador que te envíe uno nuevo.
        </p>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

export interface CredentialsTemplateInput {
  nombre: string;
  usuario: string;
  /** One-time link that lets the user set their own password — never the password itself. */
  actionLink: string;
}

/**
 * Same intent as inviteTemplate: the account already exists, and the link is a
 * password-set link, so no password ever travels through email. Only the
 * assigned username is shown, in a "code" box, alongside the link.
 */
export function credentialsTemplate(
  input: CredentialsTemplateInput,
): { subject: string; text: string; html: string } {
  const subject = 'Tus credenciales de acceso - CORVELSA';

  const text = [
    `Hola ${input.nombre},`,
    '',
    'Se te ha asignado una cuenta de acceso en CORVELSA.',
    '',
    `Tu usuario: ${input.usuario}`,
    '',
    'Antes de tu primer inicio de sesión debes establecer tu contraseña desde este enlace:',
    input.actionLink,
    '',
    'El enlace es de un solo uso y expira, así que si deja de funcionar pide a un administrador que te envíe uno nuevo.',
    '',
    'Equipo CORVELSA',
  ].join('\n');

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f8f9fa;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1c1f24;">
    <table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
      <tr>
        <td style="background:#0d4f8b;padding:28px 32px;">
          <h1 style="margin:0;font-size:20px;color:#fff;">CORVELSA</h1>
          <p style="margin:4px 0 0;font-size:14px;color:#cfe0f2;">Credenciales de acceso</p>
        </td>
      </tr>
      <tr>
        <td style="padding:32px;background:#f8f9fa;">
          <p style="margin:0 0 16px;line-height:1.5;">Hola <strong>${escapeHtml(input.nombre)}</strong>,</p>
          <p style="margin:0 0 20px;line-height:1.5;">
            Se te ha asignado una cuenta de acceso en CORVELSA. Estos son tus datos:
          </p>

          <p style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#5c6270;">Usuario</p>
          <p style="margin:0 0 20px;padding:12px 16px;background:#eef1f4;border:1px solid #d7dce1;border-radius:8px;
                     font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:15px;color:#0d4f8b;">
            ${escapeHtml(input.usuario)}
          </p>

          <div style="margin:0 0 24px;padding:14px 16px;background:#fff6e5;border:1px solid #f2d998;border-radius:8px;">
            <p style="margin:0;font-size:14px;line-height:1.5;color:#7a5b00;">
              Por seguridad, no se envía ninguna contraseña por correo. Usa el botón de abajo para
              establecer la tuya antes de iniciar sesión por primera vez.
            </p>
          </div>

          <p style="margin:0 0 24px;text-align:center;">
            <a href="${escapeHtml(input.actionLink)}"
               style="display:inline-block;padding:12px 24px;background:#0d4f8b;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">
              Configurar mi contraseña
            </a>
          </p>

          <p style="margin:0 0 4px;font-size:13px;color:#5c6270;line-height:1.5;">
            El enlace es de un solo uso y expira. Si deja de funcionar, pide a un administrador que te
            envíe uno nuevo.
          </p>
          <p style="margin:24px 0 0;font-size:13px;color:#5c6270;">— Equipo CORVELSA</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}
