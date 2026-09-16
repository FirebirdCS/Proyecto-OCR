import 'dotenv/config';
import { z } from 'zod';

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const booleanish = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  /**
   * Origins allowed to call the API, comma-separated — the dev server and the
   * deployed site can both be listed. An origin is scheme + host + port only.
   */
  CLIENT_ORIGIN: z
    .string()
    .default('http://localhost:5173')
    .refine(
      (value) => value.split(',').every((entry) => z.string().url().safeParse(entry.trim()).success),
      'Every CLIENT_ORIGIN entry must be a URL',
    ),
  /**
   * Where the app actually lives, including any sub-path (GitHub Pages serves a
   * project at /<repo>/). Used for the links in invite emails. Defaults to the
   * first CLIENT_ORIGIN.
   */
  CLIENT_APP_URL: z.string().url().optional(),
  /** Used in invite emails and their subject lines. */
  APP_NAME: z.string().default('OCR Platform'),

  // Firebase Admin — either GOOGLE_APPLICATION_CREDENTIALS or the inline trio.
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  FIREBASE_DATABASE_URL: z.string().url().optional(),

  // Comma-separated emails that are promoted to admin on first sign-in.
  BOOTSTRAP_ADMIN_EMAILS: z.string().optional(),

  // OCR
  VISION_KEY_FILE: z.string().optional(),
  OCR_MAX_UPLOAD_MB: z.coerce.number().positive().default(10),

  // IANA zone the admin dashboard buckets sales days in; defaults to the server's.
  STATS_TIME_ZONE: z.string().refine(isTimeZone, 'Unknown IANA time zone').optional(),

  // Scanned receipts are kept here as evidence for review. Empty: not stored.
  FIREBASE_STORAGE_BUCKET: z.string().optional(),

  // Abuse limits: scans per user in any rolling 24 hours, and units a single
  // receipt may count in a campaign before the excess is dropped.
  SCAN_DAILY_LIMIT: z.coerce.number().int().positive().default(20),
  RECEIPT_MAX_UNITS: z.coerce.number().int().positive().default(50),

  // SMTP
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: booleanish.default('false'),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('OCR Platform <no-reply@example.com>'),

  // Resend — used for the credentials email only, separate from SMTP.
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().default('CORVELSA <info@corvelsa.com>'),
});

// An empty value in a .env file ("FOO=") should mean "not set", not "".
const rawEnv = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => value !== undefined && value !== ''),
);

const parsed = schema.safeParse(rawEnv);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';

/** Every origin the browser may call the API from. */
export const clientOrigins = env.CLIENT_ORIGIN.split(',').map((entry) => entry.trim());

/** The app's public address, without a trailing slash. */
export const clientAppUrl = (env.CLIENT_APP_URL ?? clientOrigins[0]!).replace(/\/$/, '');
