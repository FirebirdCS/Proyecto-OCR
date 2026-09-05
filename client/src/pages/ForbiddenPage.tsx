import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export function ForbiddenPage() {
  const { role } = useAuth();

  return (
    <div className="content-center">
      <section className="card">
        <h1>No permitido</h1>
        <p className="muted stack-top">
          Esta página requiere un rol superior a <strong>{role ?? 'desconocido'}</strong>.
        </p>
        <p className="stack-top">
          <Link to="/">Volver al panel</Link>
        </p>
      </section>
    </div>
  );
}
