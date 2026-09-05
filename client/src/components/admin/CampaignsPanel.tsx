import { useEffect, useState } from 'react';
import { Archive, Eye, Megaphone, Pencil, PlayCircle, RotateCcw, Trash2 } from 'lucide-react';
import { api, type UserProfile } from '../../services/api';
import type { Campaign, CampaignStatus, Product } from '../../types/campaigns';
import { CampaignEditor } from './CampaignEditor';
import { ActionsMenu, type ActionsMenuItem } from '../ui/ActionsMenu';
import { STATUS_LABELS } from '../../lib/labels';

type View = { mode: 'list' } | { mode: 'new' } | { mode: 'edit'; campaign: Campaign };

const NEXT_STATUS: Record<
  CampaignStatus,
  { label: string; next: CampaignStatus; icon: typeof PlayCircle } | null
> = {
  draft: { label: 'Iniciar', next: 'active', icon: PlayCircle },
  active: { label: 'Archivar', next: 'archived', icon: Archive },
  archived: { label: 'Volver a borrador', next: 'draft', icon: RotateCcw },
};

export function CampaignsPanel() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [view, setView] = useState<View>({ mode: 'list' });

  useEffect(() => {
    let cancelled = false;

    // The editor needs the product catalogue and the roster, so load all three.
    Promise.all([api.admin.listCampaigns(), api.admin.listProducts(), api.admin.listUsers()])
      .then(([campaignResult, productResult, userResult]) => {
        if (cancelled) return;
        setCampaigns(campaignResult.campaigns);
        setProducts(productResult.products);
        setUsers(userResult.users);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'No se pudieron cargar las campañas');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function upsert(saved: Campaign) {
    setCampaigns((current) => {
      const exists = current.some((entry) => entry.id === saved.id);
      return exists
        ? current.map((entry) => (entry.id === saved.id ? saved : entry))
        : [saved, ...current];
    });
    setView({ mode: 'list' });
  }

  async function changeStatus(campaign: Campaign, status: CampaignStatus) {
    setPendingId(campaign.id);
    setError(null);
    try {
      const updated = await api.admin.setCampaignStatus(campaign.id, status);
      setCampaigns((current) =>
        current.map((entry) => (entry.id === campaign.id ? updated : entry)),
      );
    } catch (cause) {
      // The API refuses to start a campaign with no products or no milestones.
      setError(cause instanceof Error ? cause.message : 'No se pudo cambiar el estado');
    } finally {
      setPendingId(null);
    }
  }

  async function remove(campaign: Campaign) {
    if (!window.confirm(`¿Eliminar "${campaign.name}"? Esto no se puede deshacer.`)) return;

    setPendingId(campaign.id);
    setError(null);
    try {
      await api.admin.deleteCampaign(campaign.id);
      setCampaigns((current) => current.filter((entry) => entry.id !== campaign.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo eliminar la campaña');
    } finally {
      setPendingId(null);
    }
  }

  if (view.mode !== 'list') {
    return (
      <CampaignEditor
        campaign={view.mode === 'edit' ? view.campaign : undefined}
        products={products}
        users={users}
        onSaved={upsert}
        onCancel={() => setView({ mode: 'list' })}
      />
    );
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-text">
          <h1 className="page-header-title">Campañas</h1>
          <p className="page-header-subtitle">
            Administra las campañas disponibles y sus configuraciones.
          </p>
        </div>
        <div className="page-header-actions">
          <button type="button" onClick={() => setView({ mode: 'new' })}>
            + Nueva campaña
          </button>
        </div>
      </div>

      <section className="panel-section">
        {loading && <p className="muted">Cargando...</p>}
        {error && <p className="error">{error}</p>}
        {!loading && campaigns.length === 0 && (
          <div className="empty-state">
            <Megaphone />
            <p>
              Aún no hay campañas. Una campaña define qué productos puntúan, cuánto valen, y los
              hitos que cada usuario asignado debe alcanzar.
            </p>
          </div>
        )}

        {campaigns.length > 0 && (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Campaña</th>
                  <th>Estado</th>
                  <th>Ventana</th>
                  <th>Reglas</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => {
                  const busy = pendingId === campaign.id;
                  const transition = NEXT_STATUS[campaign.status];
                  const top = campaign.milestones.reduce(
                    (max, entry) => Math.max(max, entry.targetPoints),
                    0,
                  );

                  const items: ActionsMenuItem[] = [
                    {
                      key: 'edit',
                      label: campaign.status === 'archived' ? 'Ver' : 'Editar',
                      icon: campaign.status === 'archived' ? <Eye /> : <Pencil />,
                      onClick: () => setView({ mode: 'edit', campaign }),
                    },
                  ];

                  if (transition) {
                    items.push({
                      key: 'transition',
                      label: transition.label,
                      icon: <transition.icon />,
                      disabled: busy,
                      onClick: () => void changeStatus(campaign, transition.next),
                    });
                  }

                  items.push({
                    key: 'delete',
                    label: 'Eliminar',
                    icon: <Trash2 />,
                    danger: true,
                    disabled: busy || campaign.status === 'active',
                    onClick: () => void remove(campaign),
                  });

                  return (
                    <tr key={campaign.id}>
                      <td>
                        <div>{campaign.name}</div>
                        {campaign.description && (
                          <div className="muted">{campaign.description}</div>
                        )}
                      </td>
                      <td>
                        <span className={`badge badge-${campaign.status}`}>{STATUS_LABELS[campaign.status]}</span>
                      </td>
                      <td className="muted">
                        {new Date(campaign.startsAt).toLocaleDateString()} a{' '}
                        {new Date(campaign.endsAt).toLocaleDateString()}
                      </td>
                      <td className="muted">
                        {campaign.products.length} productos, {campaign.milestones.length} hitos
                        {top > 0 && ` (tope ${top} pts)`}, {campaign.participantUids.length} usuarios
                      </td>
                      <td className="actions">
                        <ActionsMenu label={`Acciones para ${campaign.name}`} items={items} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
