import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { APP_NAME } from '../lib/navigation';
import logo from '../assets/LOGO.png';

/**
 * There is no public sign-up: accounts are created by an admin, who triggers an
 * invite email carrying a set-your-password link. This page only signs people
 * in and lets them ask for a fresh password link.
 */
export function LoginPage() {
  const { user, signIn, resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await signIn(email, password);
    } catch {
      // Firebase distinguishes "no such user" from "wrong password"; repeating
      // that back would let anyone probe for valid addresses.
      setError('Esa combinación de correo y contraseña no funcionó.');
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    if (!email) {
      setError('Ingresa primero tu dirección de correo.');
      return;
    }

    setError(null);
    setBusy(true);
    try {
      await resetPassword(email);
    } catch {
      // Deliberately quiet about whether the address exists.
    } finally {
      setNotice(`Si ${email} tiene una cuenta, un enlace para la contraseña está en camino.`);
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <aside className="login-branding">
        <div className="login-shapes" aria-hidden="true">
          <svg className="shape-a" viewBox="0 0 200 200" fill="none">
            <circle cx="100" cy="100" r="96" stroke="#fff" strokeWidth="3" />
          </svg>
          <svg className="shape-b" viewBox="0 0 200 200" fill="none">
            <path d="M20 20 L180 20 L100 180 Z" fill="#fff" />
          </svg>
          <svg className="shape-c" viewBox="0 0 120 120" fill="none">
            <circle cx="60" cy="60" r="58" stroke="#fff" strokeWidth="2" />
          </svg>
        </div>

        <div className="login-branding-content">
          <img className="login-branding-logo" src={logo} alt="" />
          <span className="login-branding-name">{APP_NAME}</span>
          <p className="login-branding-tagline">Gestión inteligente de campañas y beneficios.</p>
        </div>
      </aside>

      <div className="login-form-side">
        <div className="login-form">
          <div className="login-mobile-header">
            <img src={logo} alt="" />
            <span className="login-mobile-header-name">{APP_NAME}</span>
          </div>

          <div className="login-form-header">
            <h1>Iniciar sesión</h1>
            <p>Ingresa tus credenciales para continuar.</p>
          </div>

          <form onSubmit={handleSubmit}>
            <label htmlFor="login-email">
              Correo electrónico
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </label>

            <label htmlFor="login-password">
              Contraseña
              <div className="input-group">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label>

            <button type="submit" disabled={busy}>
              {busy ? 'Procesando...' : 'Iniciar sesión'}
            </button>
          </form>

          {error && <p className="error stack-top">{error}</p>}
          {notice && <p className="muted stack-top">{notice}</p>}

          <div className="login-form-footer">
            <button type="button" className="link" onClick={() => void handleReset()} disabled={busy}>
              ¿Olvidaste tu contraseña?
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
