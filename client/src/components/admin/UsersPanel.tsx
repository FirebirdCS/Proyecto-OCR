import { useEffect, useState, type FormEvent } from 'react';
import { Ban, CheckCircle2, Send, Users as UsersIcon } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { api, type CreateUserResult, type UserProfile } from '../../services/api';
import { ROLES, type Role } from '../../types/roles';
import { ROLE_LABELS } from '../../lib/labels';
import { getInitials } from '../../lib/format';

export function UsersPanel() {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingUid, setPendingUid] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [creating, setCreating] = useState(false);
  const [lastInvite, setLastInvite] = useState<CreateUserResult | null>(null);

  useEffect(() => {
    let cancelled = false;

    api.admin
      .listUsers()
      .then((result) => {
        if (!cancelled) setUsers(result.users);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los usuarios');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLastInvite(null);
    setCreating(true);
    try {
      // New accounts are always plain users; promote afterwards if needed.
      const result = await api.admin.createUser({
        email,
        displayName: displayName.trim() || undefined,
      });
      setUsers((current) => [result.profile, ...current]);
      setLastInvite(result);
      setEmail('');
      setDisplayName('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo crear la cuenta');
    } finally {
      setCreating(false);
    }
  }

  async function run(uid: string, action: () => Promise<UserProfile>) {
    setPendingUid(uid);
    setError(null);
    try {
      const updated = await action();
      setUsers((current) => current.map((entry) => (entry.uid === uid ? updated : entry)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Eso no funcionó');
    } finally {
      setPendingUid(null);
    }
  }

  async function resend(uid: string) {
    setPendingUid(uid);
    setError(null);
    try {
      setLastInvite(await api.admin.resendInvite(uid));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo enviar la invitación');
    } finally {
      setPendingUid(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-text">
          <h1 className="page-header-title">Usuarios</h1>
          <p className="page-header-subtitle">Administra usuarios, roles y accesos al sistema.</p>
        </div>
      </div>

      <section className="panel-section">
        <h2>Invitar a alguien</h2>
        <p className="panel-section-hint">
          Crea la cuenta y envía por correo un enlace para elegir contraseña. Las cuentas nuevas
          empiezan con el rol de usuario.
        </p>

        <form className="inline-form" onSubmit={handleCreate}>
          <label>
            Correo
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="persona@ejemplo.com"
              required
            />
          </label>

          <label>
            Nombre (opcional)
            <input
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Ada Lovelace"
            />
          </label>

          <button type="submit" disabled={creating}>
            {creating ? 'Creando...' : 'Crear e invitar'}
          </button>
        </form>

        {lastInvite && (
          <div className={lastInvite.invited ? 'notice notice-ok' : 'notice notice-warn'}>
            {lastInvite.invited ? (
              <p>Invitación enviada a {lastInvite.profile.email}.</p>
            ) : (
              <>
                <p>
                  SMTP no está configurado, así que no se envió ningún correo. Envía este enlace a{' '}
                  {lastInvite.profile.email} tú mismo:
                </p>
                <code className="break">{lastInvite.inviteLink}</code>
              </>
            )}
          </div>
        )}
      </section>

      <section className="panel-section">
        <h2>Cuentas</h2>
        {loading && <p className="muted">Cargando...</p>}
        {error && <p className="error">{error}</p>}
        {!loading && users.length === 0 && (
          <div className="empty-state">
            <UsersIcon />
            <p>Aún no hay cuentas. Invita a la primera persona arriba.</p>
          </div>
        )}

        {!loading && users.length > 0 && (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Cuenta</th>
                  <th>Rol</th>
                  <th>Último acceso</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((entry) => {
                  const isSelf = entry.uid === user?.uid;
                  const busy = pendingUid === entry.uid;

                  return (
                    <tr key={entry.uid} className={entry.disabled ? 'row-muted' : undefined}>
                      <td>
                        <div className="account-cell">
                          <span className="avatar">{getInitials(entry.displayName, entry.email)}</span>
                          <div>
                            <div>
                              {entry.displayName ?? entry.email ?? entry.uid}
                              {isSelf && <span className="muted"> (tú)</span>}
                              {entry.disabled && (
                                <span className="badge badge-warn">deshabilitada</span>
                              )}
                            </div>
                            {entry.displayName && <div className="muted">{entry.email}</div>}
                          </div>
                        </div>
                      </td>
                      <td>
                        <select
                          value={entry.role}
                          // Demoting yourself would lock this panel away.
                          disabled={busy || isSelf}
                          onChange={(event) =>
                            void run(entry.uid, () =>
                              api.admin.setRole(entry.uid, event.target.value as Role),
                            )
                          }
                        >
                          {ROLES.map((role) => (
                            <option key={role} value={role}>
                              {ROLE_LABELS[role]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="muted">
                        {entry.lastSeenAt ? new Date(entry.lastSeenAt).toLocaleString() : 'nunca'}
                      </td>
                      <td className="actions">
                        <button
                          type="button"
                          className="icon-btn"
                          disabled={busy}
                          onClick={() => void resend(entry.uid)}
                          aria-label={`Reenviar invitación a ${entry.email ?? entry.uid}`}
                          title="Reenviar invitación"
                        >
                          <Send />
                        </button>
                        <button
                          type="button"
                          className={entry.disabled ? 'icon-btn' : 'icon-btn danger'}
                          disabled={busy || isSelf}
                          onClick={() =>
                            void run(entry.uid, () =>
                              api.admin.setDisabled(entry.uid, !entry.disabled),
                            )
                          }
                          aria-label={entry.disabled ? 'Habilitar cuenta' : 'Deshabilitar cuenta'}
                          title={entry.disabled ? 'Habilitar' : 'Deshabilitar'}
                        >
                          {entry.disabled ? <CheckCircle2 /> : <Ban />}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="muted">
          Un cambio de rol llega a la otra cuenta cuando se renueva su token de ID: en una hora, o
          de inmediato si cierra sesión y vuelve a entrar.
        </p>
      </section>
    </div>
  );
}
