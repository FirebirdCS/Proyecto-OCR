import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, Ban, ExternalLink, Receipt } from 'lucide-react';
import { api } from '../../services/api';
import { formatNumber } from '../../lib/format';
import { SCAN_FLAG_LABELS, SCAN_STATUS_LABELS, describeIssue, formatDay } from '../../lib/receipts';
import type { ScanRecord, ScanStatus } from '../../types/scoring';

type Filter = 'all' | 'flagged';

const STATUS_BADGE: Record<ScanStatus, string> = {
  scored: 'badge badge-active',
  unscored: 'badge badge-draft',
  voided: 'badge badge-danger',
};

function formatMoment(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }) : '-';
}

const ownerLabel = (scan: ScanRecord) => scan.ownerName ?? scan.ownerEmail ?? scan.ownerUid;

/** The stored file, fetched through a short-lived link when the scan is opened. */
function Evidence({ scan }: { scan: ScanRecord }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!scan.hasFile) return;
    let cancelled = false;
    setUrl(null);
    setError(null);

    api.admin
      .scanFileUrl(scan.id)
      .then((result) => {
        if (!cancelled) setUrl(result.url);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'No se pudo abrir el archivo');
      });

    return () => {
      cancelled = true;
    };
  }, [scan.id, scan.hasFile]);

  if (!scan.hasFile) {
    return <p className="muted">No se guardó el archivo de este comprobante.</p>;
  }
  if (error) return <p className="error">{error}</p>;
  if (!url) return <div className="skeleton skeleton-evidence" />;

  return (
    <div className="evidence-frame">
      {scan.contentType === 'application/pdf' ? (
        <p>El comprobante es un PDF.</p>
      ) : (
        <img className="scan-evidence" src={url} alt={`Comprobante ${scan.filename}`} />
      )}
      <a href={url} target="_blank" rel="noreferrer" className="evidence-link">
        <ExternalLink size={14} />
        Abrir el original
      </a>
    </div>
  );
}

function ScanDetail({ scan, onChanged }: { scan: ScanRecord; onChanged: (scan: ScanRecord) => void }) {
  const [reason, setReason] = useState('');
  const [voiding, setVoiding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReason('');
    setError(null);
  }, [scan.id]);

  async function handleVoid(event: FormEvent) {
    event.preventDefault();
    if (!window.confirm(`¿Anular los ${scan.pointsAwarded} puntos de este comprobante? No se puede deshacer.`)) return;

    setVoiding(true);
    setError(null);
    try {
      onChanged(await api.admin.voidScan(scan.id, reason));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo anular el comprobante');
    } finally {
      setVoiding(false);
    }
  }

  return (
    <section className="panel-section review-detail">
      <div className="row">
        <h2>{scan.filename}</h2>
        <span>
          <span className={STATUS_BADGE[scan.status]}>{SCAN_STATUS_LABELS[scan.status]}</span>
          {scan.flags.length > 0 && <span className="badge badge-warn">Revisar</span>}
        </span>
      </div>

      <dl className="meta-list">
        <dt>Usuario</dt>
        <dd>{ownerLabel(scan)}</dd>
        <dt>Campaña</dt>
        <dd>{scan.campaignName ?? '-'}</dd>
        <dt>Escaneado</dt>
        <dd>{formatMoment(scan.createdAt)}</dd>
        <dt>Fecha del comprobante</dt>
        <dd>{scan.receiptDate ? formatDay(scan.receiptDate) : '-'}</dd>
        <dt>Puntos</dt>
        <dd>{formatNumber(scan.pointsAwarded)}</dd>
      </dl>

      {scan.voided && (
        <div className="notice">
          <p>
            <strong>Anulado</strong> el {formatMoment(scan.voided.at)}. Motivo: {scan.voided.reason}
          </p>
        </div>
      )}

      {scan.flags.length > 0 && (
        <div className="notice notice-warn">
          <p className="notice-title">
            <AlertTriangle size={16} />
            Motivos para revisar
          </p>
          {scan.flags.map((flag) => (
            <p key={flag}>{SCAN_FLAG_LABELS[flag]}</p>
          ))}
        </div>
      )}

      {scan.issues.length > 0 && (
        <div className="notice">
          {scan.issues.map((issue) => (
            <p key={issue.code}>{describeIssue(issue)}</p>
          ))}
        </div>
      )}

      <Evidence scan={scan} />

      {scan.campaign && scan.campaign.lines.length > 0 && (
        <div className="table-scroll stack-top">
          <table className="table">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="numeric">Unidades</th>
                <th className="numeric">Pts/u</th>
                <th className="numeric">Puntos</th>
              </tr>
            </thead>
            <tbody>
              {scan.campaign.lines.map((line) => (
                <tr key={line.productId}>
                  <td>{line.productName}</td>
                  <td className="numeric">{formatNumber(line.quantity)}</td>
                  <td className="numeric">{formatNumber(line.pointsPerUnit)}</td>
                  <td className="numeric">{formatNumber(line.points)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <details className="stack-top">
        <summary>Ver texto extraído</summary>
        <pre>{scan.text || '(no se detectó texto)'}</pre>
      </details>

      {scan.status === 'scored' && (
        <form className="void-form" onSubmit={handleVoid}>
          <label>
            Motivo de la anulación
            <input
              type="text"
              value={reason}
              minLength={3}
              maxLength={300}
              required
              disabled={voiding}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Comprobante alterado, duplicado…"
            />
          </label>
          <button type="submit" className="danger" disabled={voiding || reason.trim().length < 3}>
            <Ban size={15} />
            {voiding ? 'Anulando...' : 'Anular puntos'}
          </button>
        </form>
      )}
      {error && <p className="error stack-top">{error}</p>}
    </section>
  );
}

/**
 * Every scan with its evidence. Flagged scans (unusual quantities, frequent
 * senders, missing file) earn their points like any other, and land here so an
 * admin can check them and take the points back if they are not genuine.
 */
export function ScansPanel() {
  const [filter, setFilter] = useState<Filter>('all');
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(
    async (current: Filter, before: string | undefined, isCancelled: () => boolean = () => false) => {
      setError(null);
      try {
        const result = await api.admin.listScans({ flaggedOnly: current === 'flagged', before });
        if (isCancelled()) return;
        setScans((existing) => (before ? [...existing, ...result.scans] : result.scans));
        setNextBefore(result.nextBefore);
      } catch (cause) {
        if (!isCancelled()) {
          setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los comprobantes');
        }
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSelectedId(null);
    void load(filter, undefined, () => cancelled).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [filter, load]);

  async function loadMore() {
    if (!nextBefore) return;
    setLoadingMore(true);
    await load(filter, nextBefore);
    setLoadingMore(false);
  }

  const selected = scans.find((scan) => scan.id === selectedId) ?? null;

  return (
    <div>
      <div className="page-header">
        <div className="page-header-text">
          <h1 className="page-header-title">Comprobantes</h1>
          <p className="page-header-subtitle">
            Revisa los comprobantes escaneados con su evidencia y anula los puntos de los que no sean
            válidos.
          </p>
        </div>
      </div>

      <div className="review-layout">
        <section className="panel-section">
          <div className="section-header">
            <h2>Escaneos recientes</h2>
            <div className="segmented" role="group" aria-label="Filtrar comprobantes">
              <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
                Todos
              </button>
              <button type="button" aria-pressed={filter === 'flagged'} onClick={() => setFilter('flagged')}>
                Para revisar
              </button>
            </div>
          </div>

          {error && <p className="error">{error}</p>}

          {loading ? (
            <div aria-busy="true">
              <span className="sr-only" role="status">
                Cargando comprobantes…
              </span>
              {Array.from({ length: 6 }, (_, index) => (
                <span key={index} className="skeleton skeleton-row" aria-hidden="true" />
              ))}
            </div>
          ) : scans.length === 0 ? (
            <div className="empty-state">
              <Receipt />
              <p>
                {filter === 'flagged'
                  ? 'No hay comprobantes marcados para revisar.'
                  : 'Aún no se ha escaneado ningún comprobante.'}
              </p>
            </div>
          ) : (
            <>
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Escaneado</th>
                      <th>Usuario</th>
                      <th>Campaña</th>
                      <th className="numeric">Puntos</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scans.map((scan) => (
                      <tr
                        key={scan.id}
                        className={scan.id === selectedId ? 'clickable row-selected' : 'clickable'}
                        onClick={() => setSelectedId(scan.id)}
                      >
                        <td>
                          <button
                            type="button"
                            className="link"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedId(scan.id);
                            }}
                          >
                            {formatMoment(scan.createdAt)}
                          </button>
                        </td>
                        <td>{ownerLabel(scan)}</td>
                        <td className="muted">{scan.campaignName ?? '-'}</td>
                        <td className="numeric">{formatNumber(scan.pointsAwarded)}</td>
                        <td>
                          <span className={STATUS_BADGE[scan.status]}>{SCAN_STATUS_LABELS[scan.status]}</span>
                          {scan.flags.length > 0 && <span className="badge badge-warn">Revisar</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {nextBefore && (
                <button type="button" className="ghost stack-top" disabled={loadingMore} onClick={() => void loadMore()}>
                  {loadingMore ? 'Cargando...' : 'Cargar más'}
                </button>
              )}
            </>
          )}
        </section>

        {selected ? (
          <ScanDetail
            scan={selected}
            onChanged={(updated) =>
              setScans((current) => current.map((scan) => (scan.id === updated.id ? updated : scan)))
            }
          />
        ) : (
          !loading &&
          scans.length > 0 && (
            <section className="panel-section review-detail">
              <div className="empty-state">
                <Receipt />
                <p>Selecciona un comprobante para ver su evidencia.</p>
              </div>
            </section>
          )
        )}
      </div>
    </div>
  );
}
