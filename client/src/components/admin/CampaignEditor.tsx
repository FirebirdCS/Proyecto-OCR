import { useState, type FormEvent } from 'react';
import { api, type UserProfile } from '../../services/api';
import {
  activationProblems,
  type Campaign,
  type CampaignInput,
  type CampaignProduct,
  type Milestone,
  type Product,
} from '../../types/campaigns';
import { ROLE_LABELS } from '../../lib/labels';
import { ArrowLeft } from 'lucide-react';

/** `datetime-local` inputs want `YYYY-MM-DDTHH:mm`; the API speaks ISO/UTC. */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

function blankCampaign(): CampaignInput {
  const now = new Date();
  const inAMonth = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  return {
    name: '',
    description: '',
    startsAt: now.toISOString(),
    endsAt: inAMonth.toISOString(),
    products: [],
    milestones: [],
    participantUids: [],
  };
}

function toInput(campaign: Campaign): CampaignInput {
  return {
    name: campaign.name,
    description: campaign.description,
    startsAt: campaign.startsAt,
    endsAt: campaign.endsAt,
    products: campaign.products,
    milestones: campaign.milestones,
    participantUids: campaign.participantUids,
  };
}

export interface CampaignEditorProps {
  /** Omit to build a new campaign. */
  campaign?: Campaign;
  products: Product[];
  users: UserProfile[];
  onSaved: (campaign: Campaign) => void;
  onCancel: () => void;
}

export function CampaignEditor({
  campaign,
  products,
  users,
  onSaved,
  onCancel,
}: CampaignEditorProps) {
  const [draft, setDraft] = useState<CampaignInput>(() =>
    campaign ? toInput(campaign) : blankCampaign(),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readOnly = campaign?.status === 'archived';
  const problems = activationProblems(draft);

  function update(patch: Partial<CampaignInput>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  /* ------------------------------------------------------------- products */

  function toggleProduct(product: Product, selected: boolean) {
    update({
      products: selected
        ? [
            ...draft.products,
            // Seed the override from the product default; the admin can retune it.
            { productId: product.id, points: product.points, required: false, minQuantity: 0 },
          ]
        : draft.products.filter((entry) => entry.productId !== product.id),
    });
  }

  function patchProduct(productId: string, patch: Partial<CampaignProduct>) {
    update({
      products: draft.products.map((entry) =>
        entry.productId === productId ? { ...entry, ...patch } : entry,
      ),
    });
  }

  /* ----------------------------------------------------------- milestones */

  function addMilestone() {
    const highest = draft.milestones.reduce(
      (max, entry) => Math.max(max, entry.targetPoints),
      0,
    );

    update({
      milestones: [
        ...draft.milestones,
        {
          id: `m${Date.now().toString(36)}`,
          name: `Hito ${draft.milestones.length + 1}`,
          // Each rung has to sit above the last, so start above the current top.
          targetPoints: highest + 100,
          reward: '',
        },
      ],
    });
  }

  function patchMilestone(id: string, patch: Partial<Milestone>) {
    update({
      milestones: draft.milestones.map((entry) =>
        entry.id === id ? { ...entry, ...patch } : entry,
      ),
    });
  }

  function removeMilestone(id: string) {
    update({ milestones: draft.milestones.filter((entry) => entry.id !== id) });
  }

  const milestonesAscend = draft.milestones.every(
    (entry, index) => index === 0 || entry.targetPoints > draft.milestones[index - 1]!.targetPoints,
  );

  /* --------------------------------------------------------- participants */

  function toggleParticipant(uid: string, selected: boolean) {
    update({
      participantUids: selected
        ? [...draft.participantUids, uid]
        : draft.participantUids.filter((entry) => entry !== uid),
    });
  }

  /* ----------------------------------------------------------------- save */

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const payload: CampaignInput = {
        ...draft,
        milestones: draft.milestones.map((entry) => ({
          ...entry,
          reward: entry.reward?.trim() || undefined,
        })),
      };

      const saved = campaign
        ? await api.admin.updateCampaign(campaign.id, payload)
        : await api.admin.createCampaign(payload);

      onSaved(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la campaña');
    } finally {
      setSaving(false);
    }
  }

  const assignable = users.filter((entry) => !entry.disabled);

  return (
    <form className="editor" onSubmit={handleSubmit}>
      <header className="row">
        <h1 className="page-header-title">{campaign ? `Editar ${campaign.name}` : 'Nueva campaña'}</h1>
        <button type="button" className="ghost" onClick={onCancel}>
          <ArrowLeft size={15} />
          Volver a campañas
        </button>
      </header>

      {readOnly && <p className="notice notice-warn">Las campañas archivadas son de solo lectura.</p>}

      <fieldset disabled={readOnly || saving}>
        <div className="grid-2">
          <label>
            Nombre
            <input
              type="text"
              value={draft.name}
              onChange={(event) => update({ name: event.target.value })}
              placeholder="Impulso de primavera"
              required
            />
          </label>

          <label>
            Descripción
            <input
              type="text"
              value={draft.description}
              onChange={(event) => update({ description: event.target.value })}
              placeholder="Para qué es esta campaña"
            />
          </label>

          <label>
            Inicia
            <input
              type="datetime-local"
              value={toLocalInput(draft.startsAt)}
              onChange={(event) => update({ startsAt: fromLocalInput(event.target.value) })}
              required
            />
          </label>

          <label>
            Termina
            <input
              type="datetime-local"
              value={toLocalInput(draft.endsAt)}
              onChange={(event) => update({ endsAt: fromLocalInput(event.target.value) })}
              required
            />
          </label>
        </div>

        {/* ------------------------------------------------------ products */}
        <section className="panel-section">
          <h3>Productos que cuentan</h3>
          <p className="muted">
            Marca lo que puntúa en esta campaña. Los puntos parten del valor del producto y se
            pueden ajustar aquí sin tocar el producto en sí. Marca un producto como obligatorio
            para exigir una cantidad mínima además de la meta de puntos.
          </p>

          {products.length === 0 && (
            <p className="notice notice-warn">
              Aún no existen productos. Agrega algunos en la pestaña Productos primero.
            </p>
          )}

          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Cuenta</th>
                  <th>Producto</th>
                  <th>Por defecto</th>
                  <th>Puntos aquí</th>
                  <th>Obligatorio</th>
                  <th>Cant. mín.</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => {
                  const entry = draft.products.find((item) => item.productId === product.id);

                  return (
                    <tr key={product.id} className={product.active ? undefined : 'row-muted'}>
                      <td>
                        <input
                          type="checkbox"
                          checked={Boolean(entry)}
                          disabled={!product.active && !entry}
                          onChange={(event) => toggleProduct(product, event.target.checked)}
                        />
                      </td>
                      <td>
                        {product.name}
                        {!product.active && <span className="badge badge-warn">inactivo</span>}
                      </td>
                      <td className="muted">{product.points}</td>
                      <td>
                        <input
                          className="points-input"
                          type="number"
                          min={0}
                          value={entry?.points ?? product.points}
                          disabled={!entry}
                          onChange={(event) =>
                            patchProduct(product.id, { points: Number(event.target.value) })
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={entry?.required ?? false}
                          disabled={!entry}
                          onChange={(event) =>
                            patchProduct(product.id, {
                              required: event.target.checked,
                              // The API rejects a required product with no minimum.
                              minQuantity: event.target.checked
                                ? Math.max(1, entry?.minQuantity ?? 0)
                                : 0,
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="points-input"
                          type="number"
                          min={entry?.required ? 1 : 0}
                          value={entry?.minQuantity ?? 0}
                          disabled={!entry || !entry.required}
                          onChange={(event) =>
                            patchProduct(product.id, { minQuantity: Number(event.target.value) })
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* ---------------------------------------------------- milestones */}
        <section className="panel-section">
          <div className="row">
            <h3>Hitos</h3>
            <button type="button" className="ghost" onClick={addMilestone}>
              Agregar hito
            </button>
          </div>
          <p className="muted">
            Cada usuario asignado se mide individualmente contra esta misma escalera. Las metas
            deben subir de un escalón al siguiente.
          </p>

          {draft.milestones.length === 0 && (
            <p className="muted">Aún no hay hitos.</p>
          )}

          {draft.milestones.map((milestone) => (
            <div className="milestone-row" key={milestone.id}>
              <label>
                Nombre
                <input
                  type="text"
                  value={milestone.name}
                  onChange={(event) => patchMilestone(milestone.id, { name: event.target.value })}
                  required
                />
              </label>

              <label className="narrow">
                Puntos meta
                <input
                  type="number"
                  min={1}
                  value={milestone.targetPoints}
                  onChange={(event) =>
                    patchMilestone(milestone.id, { targetPoints: Number(event.target.value) })
                  }
                  required
                />
              </label>

              <label>
                Recompensa (opcional)
                <input
                  type="text"
                  value={milestone.reward ?? ''}
                  onChange={(event) => patchMilestone(milestone.id, { reward: event.target.value })}
                  placeholder="Tarjeta de regalo"
                />
              </label>

              <button
                type="button"
                className="ghost danger"
                onClick={() => removeMilestone(milestone.id)}
              >
                Quitar
              </button>
            </div>
          ))}

          {!milestonesAscend && (
            <p className="error">
              Cada hito necesita una meta más alta que la del anterior.
            </p>
          )}
        </section>

        {/* -------------------------------------------------- participants */}
        <section className="panel-section">
          <h3>Quién participa</h3>
          <p className="muted">
            {draft.participantUids.length} de {assignable.length} cuentas asignadas.
          </p>

          <div className="checkbox-grid">
            {assignable.map((entry) => (
              <label className="checkbox-row" key={entry.uid}>
                <input
                  type="checkbox"
                  checked={draft.participantUids.includes(entry.uid)}
                  onChange={(event) => toggleParticipant(entry.uid, event.target.checked)}
                />
                <span>
                  {entry.displayName ?? entry.email ?? entry.uid}
                  <span className="badge">{ROLE_LABELS[entry.role]}</span>
                </span>
              </label>
            ))}
          </div>
        </section>
      </fieldset>

      {error && <p className="error">{error}</p>}

      {problems.length > 0 && (
        <p className="notice notice-warn">
          Se puede guardar como borrador, pero aún no se puede iniciar: {problems.join('; ')}.
        </p>
      )}

      <div className="row">
        <button type="submit" disabled={saving || readOnly || !milestonesAscend}>
          {saving ? 'Guardando...' : campaign ? 'Guardar cambios' : 'Crear campaña'}
        </button>
        <button type="button" className="ghost" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
