import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { NAV_ITEMS, APP_NAME } from '../../lib/navigation';
import { ROLE_LABELS } from '../../lib/labels';
import { getInitials } from '../../lib/format';
import logo from '../../assets/LOGO.png';

const COLLAPSE_KEY = 'ocr-sidebar-collapsed';

export interface SidebarProps {
  mobileOpen: boolean;
  onNavigate: () => void;
}

export function Sidebar({ mobileOpen, onNavigate }: SidebarProps) {
  const { user, role, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        // Storage unavailable — the preference just won't persist.
      }
      return next;
    });
  }

  const items = NAV_ITEMS.filter((item) => !item.roles || (role && item.roles.includes(role)));
  const name = user?.displayName ?? user?.email ?? '';

  return (
    <aside
      className={[
        'sidebar',
        collapsed ? 'sidebar--collapsed' : '',
        mobileOpen ? 'sidebar--mobile-open' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="sidebar-brand">
        <img className="sidebar-logo" src={logo} alt="" />
        <div className="sidebar-brand-text">
          <span className="sidebar-brand-name">{APP_NAME}</span>
          <span className="sidebar-brand-sub">CORVELSA</span>
        </div>
        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'}
          title={collapsed ? 'Expandir menú' : 'Colapsar menú'}
        >
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
      </div>

      <nav className="sidebar-nav">
        {items.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            onClick={onNavigate}
            className={({ isActive }) => `sidebar-link${isActive ? ' sidebar-link--active' : ''}`}
            title={collapsed ? item.label : undefined}
          >
            <item.icon />
            <span className="sidebar-link-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <span className="avatar">{getInitials(user?.displayName, user?.email)}</span>
          <span className="sidebar-user-info">
            <span className="sidebar-user-name">{name}</span>
            {role && <span className="badge">{ROLE_LABELS[role]}</span>}
          </span>
        </div>
        <button type="button" className="sidebar-logout" onClick={() => void logout()}>
          <LogOut size={16} />
          <span>Cerrar sesión</span>
        </button>
      </div>
    </aside>
  );
}
