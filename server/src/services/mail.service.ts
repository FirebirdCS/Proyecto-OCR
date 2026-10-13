import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  if (!env.SMTP_HOST) {
    throw new HttpError(503, 'El envío de correo no está configurado (falta SMTP_HOST en .env)');
  }

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE, // true for port 465, false for STARTTLS on 587
    auth:
      env.SMTP_USER && env.SMTP_PASSWORD
        ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
        : undefined,
  });

  return transporter;
}

export interface MailMessage {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: { filename: string; content: Buffer | string; contentType?: string }[];
}

export async function sendMail(message: MailMessage): Promise<string> {
  const info = await getTransporter().sendMail({ from: env.MAIL_FROM, ...message });
  return info.messageId;
}

/** True when SMTP is configured at all — lets callers degrade instead of failing. */
export function isMailConfigured(): boolean {
  return Boolean(env.SMTP_HOST);
}

/** Confirms the SMTP credentials work. Handy on boot or in a health check. */
export async function verifySmtp(): Promise<boolean> {
  await getTransporter().verify();
  return true;
}
