import { auth } from '../lib/firebase';
import type { Role } from '../types/roles';
import type { Campaign, CampaignInput, CampaignStatus, Product } from '../types/campaigns';
import type {
  CampaignProgress,
  CampaignScore,
  DashboardStats,
  ReceiptIssue,
  ScanRecord,
  ScanScoring,
} from '../types/scoring';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Attaches the current user's Firebase ID token to every API call. */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  const headers = new Headers(init.headers);

  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${BASE_URL}/api${path}`, { ...init, headers });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      (payload as { error?: string } | null)?.error ?? response.statusText,
      (payload as { details?: unknown } | null)?.details,
    );
  }

  return payload as T;
}

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: Role;
  disabled: boolean;
  createdAt: string | null;
  lastSeenAt: string | null;
}

export interface CreateUserResult {
  profile: UserProfile;
  /** False when SMTP is not configured — hand over `inviteLink` yourself. */
  invited: boolean;
  inviteLink: string;
}

export type ProductInput = Pick<Product, 'name' | 'points' | 'active'> & { sku?: string };

export interface OcrResponse {
  documentId: string;
  text: string;
  locale?: string;
  blocks: { text: string; confidence: number }[];
  /** What the receipt earned in the campaign it was filed under, and why not more. */
  scoring: ScanScoring;
}

export interface DocumentRecord {
  id: string;
  filename: string;
  text: string;
  locale?: string;
  campaignId: string | null;
  pointsAwarded: number;
  campaign: CampaignScore | null;
  issues: ReceiptIssue[];
  receiptDate: string | null;
  createdAt: string | null;
}

export interface MyCampaignsResponse {
  campaigns: Campaign[];
  progress: CampaignProgress[];
  /** productId -> name, since users cannot read the admin product list. */
  productNames: Record<string, string>;
}

export const api = {
  /** Also provisions the profile and role claim for first-time accounts. */
  me: () => request<UserProfile>('/me'),

  /** Scores the receipt against `campaignId` only. */
  ocr: (file: File, campaignId: string) => {
    const form = new FormData();
    form.append('campaignId', campaignId);
    form.append('file', file);
    return request<OcrResponse>('/ocr', { method: 'POST', body: form });
  },

  documents: (ownerUid?: string) =>
    request<{ documents: DocumentRecord[] }>(
      ownerUid ? `/ocr/documents?ownerUid=${encodeURIComponent(ownerUid)}` : '/ocr/documents',
    ),

  /** Active campaigns the signed-in user is assigned to. */
  myCampaigns: () => request<MyCampaignsResponse>('/campaigns'),

  admin: {
    dashboard: () => request<DashboardStats>('/admin/dashboard'),

    /** Newest first. `before` is the `createdAt` of the last scan already shown. */
    listScans: (options: { flaggedOnly?: boolean; before?: string } = {}) => {
      const params = new URLSearchParams();
      if (options.flaggedOnly) params.set('flagged', 'true');
      if (options.before) params.set('before', options.before);
      const query = params.toString();
      return request<{ scans: ScanRecord[]; nextBefore: string | null }>(
        `/admin/scans${query ? `?${query}` : ''}`,
      );
    },

    /** A link to the stored receipt file, valid for a few minutes. */
    scanFileUrl: (id: string) => request<{ url: string }>(`/admin/scans/${id}/file`),

    voidScan: (id: string, reason: string) =>
      request<ScanRecord>(`/admin/scans/${id}/void`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),

    listUsers: (pageToken?: string) =>
      request<{ users: UserProfile[]; nextPageToken: string | null }>(
        pageToken ? `/admin/users?pageToken=${encodeURIComponent(pageToken)}` : '/admin/users',
      ),

    createUser: (input: { email: string; displayName?: string; role?: Role }) =>
      request<CreateUserResult>('/admin/users', {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    resendInvite: (uid: string) =>
      request<CreateUserResult>(`/admin/users/${uid}/invite`, { method: 'POST' }),

    setRole: (uid: string, role: Role) =>
      request<UserProfile>(`/admin/users/${uid}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }),

    setDisabled: (uid: string, disabled: boolean) =>
      request<UserProfile>(`/admin/users/${uid}/disabled`, {
        method: 'PATCH',
        body: JSON.stringify({ disabled }),
      }),

    listProducts: () => request<{ products: Product[] }>('/admin/products'),

    createProduct: (input: ProductInput) =>
      request<Product>('/admin/products', { method: 'POST', body: JSON.stringify(input) }),

    updateProduct: (id: string, input: Partial<ProductInput>) =>
      request<Product>(`/admin/products/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),

    deleteProduct: (id: string) =>
      request<null>(`/admin/products/${id}`, { method: 'DELETE' }),

    listCampaigns: (status?: CampaignStatus) =>
      request<{ campaigns: Campaign[] }>(
        status ? `/admin/campaigns?status=${status}` : '/admin/campaigns',
      ),

    getCampaign: (id: string) => request<Campaign>(`/admin/campaigns/${id}`),

    createCampaign: (input: CampaignInput) =>
      request<Campaign>('/admin/campaigns', { method: 'POST', body: JSON.stringify(input) }),

    updateCampaign: (id: string, input: CampaignInput) =>
      request<Campaign>(`/admin/campaigns/${id}`, { method: 'PUT', body: JSON.stringify(input) }),

    setCampaignStatus: (id: string, status: CampaignStatus) =>
      request<Campaign>(`/admin/campaigns/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),

    deleteCampaign: (id: string) =>
      request<null>(`/admin/campaigns/${id}`, { method: 'DELETE' }),
  },

  sendMail: (message: { to: string; subject: string; text?: string; html?: string }) =>
    request<{ messageId: string }>('/mail/send', {
      method: 'POST',
      body: JSON.stringify(message),
    }),
};
