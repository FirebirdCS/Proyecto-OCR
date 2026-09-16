import { randomBytes } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import type { UserRecord } from 'firebase-admin/auth';
import { auth, firestore } from '../config/firebase.js';
import { clientAppUrl, env } from '../config/env.js';
import { DEFAULT_ROLE, ROLE_CLAIM, isRole, type Role } from '../types/roles.js';
import { HttpError } from '../utils/httpError.js';
import { isResendConfigured, sendResendMail } from './resend.service.js';
import { inviteTemplate } from './mail.templates.js';

const COLLECTION = 'users';

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: Role;
  disabled: boolean;
  createdAt: string | null;
  lastSeenAt: string | null;
}

function readRole(claims: Record<string, unknown> | undefined): Role | null {
  const value = claims?.[ROLE_CLAIM];
  return isRole(value) ? value : null;
}

/** Emails listed in BOOTSTRAP_ADMIN_EMAILS become admins on first sign-in. */
function bootstrapRoleFor(email: string | undefined): Role {
  if (!email) return DEFAULT_ROLE;
  const allowlist = (env.BOOTSTRAP_ADMIN_EMAILS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(email.toLowerCase()) ? 'admin' : DEFAULT_ROLE;
}

/**
 * Called on every /api/me hit. Creates the Firestore profile the first time an
 * account shows up and makes sure the token claim and the profile agree — the
 * claim is the source of truth for authorization, the document is there so the
 * admin screen can list and search users.
 */
export async function ensureUserProfile(uid: string): Promise<UserProfile> {
  const record = await auth.getUser(uid);
  const ref = firestore.collection(COLLECTION).doc(uid);
  const snapshot = await ref.get();

  const claimRole = readRole(record.customClaims);
  const storedRole = isRole(snapshot.data()?.role) ? (snapshot.data()!.role as Role) : null;
  const role = claimRole ?? storedRole ?? bootstrapRoleFor(record.email);

  if (claimRole !== role) {
    await auth.setCustomUserClaims(uid, { ...record.customClaims, [ROLE_CLAIM]: role });
  }

  await ref.set(
    {
      email: record.email ?? null,
      displayName: record.displayName ?? null,
      role,
      lastSeenAt: FieldValue.serverTimestamp(),
      ...(snapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    },
    { merge: true },
  );

  return {
    uid,
    email: record.email ?? null,
    displayName: record.displayName ?? null,
    role,
    disabled: record.disabled,
    createdAt: snapshot.data()?.createdAt?.toDate().toISOString() ?? null,
    lastSeenAt: new Date().toISOString(),
  };
}

function toProfile(record: UserRecord): UserProfile {
  return {
    uid: record.uid,
    email: record.email ?? null,
    displayName: record.displayName ?? null,
    role: readRole(record.customClaims) ?? DEFAULT_ROLE,
    disabled: record.disabled,
    createdAt: record.metadata.creationTime ?? null,
    lastSeenAt: record.metadata.lastSignInTime ?? null,
  };
}

/** Email and name per uid from the Firestore mirror — for labelling lists, never for authorization. */
export async function getProfileSummaries(
  uids: string[],
): Promise<Map<string, { email: string | null; displayName: string | null }>> {
  if (uids.length === 0) return new Map();

  const snapshots = await firestore.getAll(...uids.map((uid) => firestore.collection(COLLECTION).doc(uid)));
  return new Map(
    snapshots.map((snapshot) => [
      snapshot.id,
      { email: snapshot.data()?.email ?? null, displayName: snapshot.data()?.displayName ?? null },
    ]),
  );
}

export async function listUsers(limit = 100, pageToken?: string) {
  const result = await auth.listUsers(Math.min(limit, 1000), pageToken);
  return {
    users: result.users.map(toProfile),
    nextPageToken: result.pageToken ?? null,
  };
}

/**
 * Sets the role claim and mirrors it into Firestore. The affected user keeps
 * their old role until their ID token refreshes (within the hour, or instantly
 * if the client calls getIdToken(true)).
 */
export async function setUserRole(uid: string, role: Role, actorUid: string): Promise<UserProfile> {
  if (uid === actorUid && role !== 'admin') {
    throw new HttpError(400, 'You cannot remove your own admin role');
  }

  const record = await auth.getUser(uid);
  await auth.setCustomUserClaims(uid, { ...record.customClaims, [ROLE_CLAIM]: role });
  await firestore
    .collection(COLLECTION)
    .doc(uid)
    .set({ role, roleUpdatedAt: FieldValue.serverTimestamp(), roleUpdatedBy: actorUid }, { merge: true });

  return { ...toProfile(record), role };
}

/**
 * Convenience for the CLI script, which knows an email rather than a uid. The
 * actor is "system", so the self-demotion guard never blocks it.
 */
export async function setRoleByEmail(email: string, role: Role): Promise<UserProfile> {
  const record = await auth.getUserByEmail(email);
  return setUserRole(record.uid, role, 'system');
}

/* ------------------------------------------------------- admin-created users */

export interface CreateUserInput {
  email: string;
  displayName?: string;
  role?: Role;
}

export interface CreateUserResult {
  profile: UserProfile;
  /** False when Resend is not configured; the link is returned so the admin can pass it on. */
  invited: boolean;
  inviteLink: string;
}

/**
 * Builds the one-time link that lets a new account choose its own password.
 * `CLIENT_APP_URL/login` has to be listed under Authentication > Settings >
 * Authorized domains in the Firebase console, or Firebase refuses the continue
 * URL.
 */
async function buildInviteLink(email: string): Promise<string> {
  return auth.generatePasswordResetLink(email, {
    url: `${clientAppUrl}/login`,
    handleCodeInApp: false,
  });
}

/**
 * Creates an account with a throwaway password the user never sees, stamps the
 * role claim, and emails a set-your-password link. There is no public sign-up,
 * so this is the only way an account comes into existence.
 */
export async function createUserAccount(
  input: CreateUserInput,
  actorUid: string,
): Promise<CreateUserResult> {
  const email = input.email.trim().toLowerCase();

  const existing = await auth.getUserByEmail(email).catch(() => null);
  if (existing) {
    throw new HttpError(409, `${email} already has an account`);
  }

  const record = await auth.createUser({
    email,
    emailVerified: false,
    displayName: input.displayName?.trim() || undefined,
    // Never surfaced anywhere: the invite link is how the user gets in.
    password: randomBytes(32).toString('base64url'),
  });

  const role = input.role ?? DEFAULT_ROLE;
  await auth.setCustomUserClaims(record.uid, { [ROLE_CLAIM]: role });

  await firestore.collection(COLLECTION).doc(record.uid).set({
    email,
    displayName: record.displayName ?? null,
    role,
    invitedBy: actorUid,
    createdAt: FieldValue.serverTimestamp(),
    lastSeenAt: null,
  });

  const inviteLink = await buildInviteLink(email);
  const invited = await deliverInvite(email, record.displayName ?? undefined, inviteLink);

  return {
    profile: { ...toProfile(record), role },
    invited,
    inviteLink,
  };
}

/** Sends (or re-sends) the invite. Returns false when Resend is not set up. */
async function deliverInvite(
  email: string,
  displayName: string | undefined,
  actionLink: string,
): Promise<boolean> {
  if (!isResendConfigured()) return false;

  const { subject, text, html } = inviteTemplate({
    appName: env.APP_NAME,
    displayName,
    email,
    actionLink,
  });

  await sendResendMail({ to: email, subject, text, html });
  return true;
}

/** Re-issues the invite for someone who never activated their account. */
export async function resendInvite(uid: string): Promise<CreateUserResult> {
  const record = await auth.getUser(uid);
  if (!record.email) throw new HttpError(400, 'That account has no email address');

  const inviteLink = await buildInviteLink(record.email);
  const invited = await deliverInvite(record.email, record.displayName ?? undefined, inviteLink);

  return { profile: toProfile(record), invited, inviteLink };
}

/** Blocks sign-in without destroying the account or its campaign history. */
export async function setUserDisabled(
  uid: string,
  disabled: boolean,
  actorUid: string,
): Promise<UserProfile> {
  if (uid === actorUid && disabled) {
    throw new HttpError(400, 'You cannot disable your own account');
  }

  await auth.updateUser(uid, { disabled });
  await firestore.collection(COLLECTION).doc(uid).set({ disabled }, { merge: true });

  return toProfile(await auth.getUser(uid));
}
