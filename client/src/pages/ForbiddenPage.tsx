import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ROLE_LABELS } from '../lib/labels';

export function ForbiddenPage() {
  const { role } = useAuth();

  return (
    <div className="content-center">
      <section className="card">
        <h1>No permitido</h1>
        <p className="muted stack-top">
          Esta página no está disponible para el rol <strong>{role ? ROLE_LABELS[role] : 'desconocido'}</strong>.
        </p>
        <p className="stack-top">
          <Link to="/">Volver al panel</Link>
        </p>
      </section>
    </div>
  );
}
