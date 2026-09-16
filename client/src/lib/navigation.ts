import { LayoutDashboard, Megaphone, Package, Receipt, Users, type LucideIcon } from 'lucide-react';
import type { Role } from '../types/roles';

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  roles?: Role[];
}

export const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Panel', icon: LayoutDashboard },
  { path: '/admin/campanas', label: 'Campañas', icon: Megaphone, roles: ['admin'] },
  { path: '/admin/productos', label: 'Productos', icon: Package, roles: ['admin'] },
  { path: '/admin/comprobantes', label: 'Comprobantes', icon: Receipt, roles: ['admin'] },
  { path: '/admin/usuarios', label: 'Usuarios', icon: Users, roles: ['admin'] },
];

export interface SectionInfo {
  title: string;
  breadcrumb?: string;
}

export const SECTION_INFO: Record<string, SectionInfo> = {
  '/': { title: 'Panel' },
  '/admin/campanas': { title: 'Campañas', breadcrumb: 'Administración' },
  '/admin/productos': { title: 'Productos', breadcrumb: 'Administración' },
  '/admin/comprobantes': { title: 'Comprobantes', breadcrumb: 'Administración' },
  '/admin/usuarios': { title: 'Usuarios', breadcrumb: 'Administración' },
  '/forbidden': { title: 'No permitido' },
};

export const APP_NAME = 'Plataforma OCR';
