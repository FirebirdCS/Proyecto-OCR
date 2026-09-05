import type { CampaignStatus } from '../types/campaigns';
import type { Role } from '../types/roles';

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrador',
  user: 'Usuario',
};

export const STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: 'Borrador',
  active: 'Activa',
  archived: 'Archivada',
};
