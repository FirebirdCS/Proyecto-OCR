import { useAuth } from '../hooks/useAuth';
import { ROLE_LABELS } from '../lib/labels';
import { getInitials } from '../lib/format';
import { AdminDashboard } from '../components/dashboard/AdminDashboard';
import { UserDashboard } from '../components/dashboard/UserDashboard';

/**
 * Same route, two audiences: admins land on the sales overview, users on their
 * campaigns and the receipt scanner. The API enforces the split too — only
 * `user` accounts may scan, and the stats endpoint is admin-only.
 */
export function DashboardPage() {
  const { user, role, isAdmin } = useAuth();
  const name = user?.displayName ?? user?.email ?? '';

  return (
    <div>
      <div className="page-header">
        <div className="page-header-text">
          <h1 className="page-header-title">Panel</h1>
          {isAdmin && (
            <p className="page-header-subtitle">Resumen de productos registrados y ventas.</p>
          )}
        </div>
      </div>

      <section className="panel-section">
        <div className="welcome-header">
          <span className="avatar avatar--lg">{getInitials(user?.displayName, user?.email)}</span>
          <div className="welcome-header-text">
            <span className="welcome-header-name">Bienvenido, {name}</span>
            <span className="welcome-header-meta">
              {user?.email}
              {role && <span className="badge">{ROLE_LABELS[role]}</span>}
            </span>
          </div>
        </div>
      </section>

      {isAdmin ? <AdminDashboard /> : <UserDashboard />}
    </div>
  );
}
