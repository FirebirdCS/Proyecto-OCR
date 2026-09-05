import { useEffect, useRef, useState } from 'react';
import { ChevronDown, LogOut } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { ROLE_LABELS } from '../../lib/labels';
import { getInitials } from '../../lib/format';

export function UserMenu() {
  const { user, role, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const name = user?.displayName ?? user?.email ?? '';

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        type="button"
        className="icon-btn user-menu-trigger"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menú de usuario"
        title={name}
      >
        <span className="avatar">{getInitials(user?.displayName, user?.email)}</span>
        <ChevronDown size={14} />
      </button>

      {open && (
        <div className="user-menu-panel" role="menu">
          <div className="user-menu-header">
            <span className="user-menu-name">{name}</span>
            {user?.email && <span className="user-menu-email">{user.email}</span>}
            {role && <span className="badge">{ROLE_LABELS[role]}</span>}
          </div>
          <button
            type="button"
            className="menu-item menu-item--danger"
            role="menuitem"
            onClick={() => void logout()}
          >
            <LogOut />
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}
