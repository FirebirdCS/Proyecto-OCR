import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import type { Role } from '../types/roles';

/** Requires a signed-in account. Add `roles` to also require a role. */
export function ProtectedRoute({ roles }: { roles?: Role[] }) {
  const { user, role, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="center-page">
        <p className="muted">Verificando tu sesión…</p>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (roles && (!role || !roles.includes(role))) return <Navigate to="/forbidden" replace />;

  return <Outlet />;
}
