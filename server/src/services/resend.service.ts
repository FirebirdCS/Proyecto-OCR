import { Resend } from 'resend';
import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';

let client: Resend | null = null;

function getClient(): Resend {
  if (client) return client;

  if (!env.RESEND_API_KEY) {
    throw new HttpError(503, 'Resend is not configured (set RESEND_API_KEY in .env)');
  }

  client = new Resend(env.RESEND_API_KEY);
  return client;
}

export interface ResendMessage {
  to: string;
  subject: string;
  text?: string;
  html: string;
}

export async function sendResendMail(message: ResendMessage): Promise<string> {
  const { data, error } = await getClient().emails.send({
    from: env.RESEND_FROM,
    ...message,
  });

  if (error) {
    throw new HttpError(502, `Resend error: ${error.message}`);
  }

  return data!.id;
}

/** True when RESEND_API_KEY is set — lets callers degrade instead of failing. */
export function isResendConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY);
}
