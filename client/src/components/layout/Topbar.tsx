import { Menu } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { ThemeToggle } from '../ui/ThemeToggle';
import { UserMenu } from './UserMenu';
import { SECTION_INFO } from '../../lib/navigation';

export interface TopbarProps {
  onOpenMobileNav: () => void;
}

export function Topbar({ onOpenMobileNav }: TopbarProps) {
  const location = useLocation();
  const section = SECTION_INFO[location.pathname] ?? { title: 'Plataforma OCR' };

  return (
    <header className="topbar">
      <button
        type="button"
        className="topbar-menu-btn"
        onClick={onOpenMobileNav}
        aria-label="Abrir menú de navegación"
      >
        <Menu size={20} />
      </button>

      <div className="topbar-titles">
        {section.breadcrumb && <span className="topbar-breadcrumb">{section.breadcrumb}</span>}
        <h1 className="topbar-title">{section.title}</h1>
      </div>

      <div className="topbar-actions">
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
