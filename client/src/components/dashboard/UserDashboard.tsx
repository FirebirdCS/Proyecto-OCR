import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Trophy } from 'lucide-react';
import { ApiError, api, type MyCampaignsResponse, type OcrResponse } from '../../services/api';
import { FileDropzone } from '../ui/FileDropzone';
import { formatNumber } from '../../lib/format';
import { describeIssue, formatDay } from '../../lib/receipts';
import type { Campaign } from '../../types/campaigns';
import type { CampaignProgress } from '../../types/scoring';

/** Only a campaign inside its dates accepts receipts — the server checks the same. */
function isRunning(campaign: Campaign, now = Date.now()): boolean {
  return Date.parse(campaign.startsAt) <= now && now < Date.parse(campaign.endsAt);
}

const REFUSALS: Record<string, string> = {
  duplicate_receipt: 'Este comprobante ya fue registrado. Cada comprobante suma puntos una sola vez.',
  not_participant: 'No participas en esta campaña.',
  campaign_not_running: 'Esta campaña no está vigente en este momento.',
  daily_limit: 'Alcanzaste el límite de comprobantes por día. Inténtalo de nuevo más tarde.',
};

function scanErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError) {
    const code = (cause.details as { code?: string } | undefined)?.code;
    if (code && REFUSALS[code]) return REFUSALS[code];
    if (cause.status === 403) return 'Solo las cuentas de usuario pueden escanear comprobantes.';
    if (cause.status === 404) return 'La campaña seleccionada ya no existe.';
  }
  return cause instanceof Error ? cause.message : 'La subida falló';
}

function CampaignCard({
  campaign,
  progress,
  productNames,
}: {
  campaign: Campaign;
  progress: CampaignProgress | undefined;
  productNames: Record<string, string>;
}) {
  const points = progress?.points ?? 0;
  const units = progress?.units ?? {};
  const ladder = [...campaign.milestones].sort((a, b) => a.targetPoints - b.targetPoints);
  const next = ladder.find((milestone) => points < milestone.targetPoints) ?? null;
  const goal = next ?? ladder.at(-1);
  const percent = goal ? Math.min(100, (points / goal.targetPoints) * 100) : 0;
  const pendingRequired = campaign.products.filter(
    (entry) => entry.required && (units[entry.productId] ?? 0) < entry.minQuantity,
  );

  return (
    <article className="campaign-item">
      <div className="campaign-item-header">
        <h3>{campaign.name}</h3>
        <span className="badge">{campaign.milestones.length} hitos</span>
      </div>
      {campaign.description && <p className="muted">{campaign.description}</p>}

      <div className="campaign-progress">
        <span className="campaign-points">
          {formatNumber(points)} <span className="muted">pts</span>
        </span>
        <div
          className="progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={goal?.targetPoints ?? 0}
          aria-valuenow={Math.min(points, goal?.targetPoints ?? 0)}
          aria-label={`Progreso en ${campaign.name}`}
        >
          <span className="progress-fill" style={{ width: `${percent}%` }} />
        </div>
        <span className="progress-meta">
          {next
            ? `Te faltan ${formatNumber(next.targetPoints - points)} pts para «${next.name}»`
            : '¡Completaste todos los hitos!'}
        </span>
      </div>

      <div className="milestone-timeline">
        {ladder.map((milestone) => {
          const reached = points >= milestone.targetPoints;
          return (
            <div
              className={reached ? 'milestone-timeline-item milestone-timeline-item--reached' : 'milestone-timeline-item'}
              key={milestone.id}
            >
              {reached ? (
                <CheckCircle2 className="milestone-timeline-check" aria-label="Alcanzado" />
              ) : (
                <span className="milestone-timeline-dot" />
              )}
              <span className="milestone-timeline-name">{milestone.name}</span>
              <span className="milestone-timeline-points">{formatNumber(milestone.targetPoints)} pts</span>
              {milestone.reward && <span className="milestone-timeline-reward">· {milestone.reward}</span>}
            </div>
          );
        })}
      </div>

      <div className="product-chips">
        {campaign.products.map((entry) => (
          <span className="product-chip" key={entry.productId}>
            {productNames[entry.productId] ?? 'Producto'}
            <span className="product-chip-meta">
              {formatNumber(entry.points)} pts/u
              {entry.required &&
                ` · obligatorio ${formatNumber(units[entry.productId] ?? 0)}/${formatNumber(entry.minQuantity)}`}
            </span>
          </span>
        ))}
      </div>

      {pendingRequired.length > 0 && (
        <p className="notice notice-warn">
          Aún te faltan productos obligatorios:{' '}
          {pendingRequired.map((entry) => productNames[entry.productId] ?? 'Producto').join(', ')}.
        </p>
      )}
    </article>
  );
}

function ScanResult({ result }: { result: OcrResponse }) {
  const { scoring } = result;
  const score = scoring.campaign;
  const warnings = scoring.issues.filter((issue) => !issue.blocking);

  return (
    <article className="stack-top">
      {!score ? (
        <div className="notice notice-warn">
          <p className="notice-title">
            <AlertTriangle size={16} />
            Este comprobante no suma puntos en «{scoring.campaignName}»
          </p>
          {scoring.issues.length > 0 ? (
            scoring.issues.map((issue) => <p key={issue.code}>{describeIssue(issue)}</p>)
          ) : (
            <p>No encontramos productos de esta campaña en el comprobante.</p>
          )}
        </div>
      ) : (
        <>
          <div className="notice notice-ok">
            <p className="notice-title">
              <CheckCircle2 size={16} />
              ¡Sumaste {formatNumber(score.pointsAwarded)} puntos en «{score.campaignName}»!
            </p>
            <p>
              {scoring.receiptDate && `Comprobante del ${formatDay(scoring.receiptDate)} · `}
              Total en la campaña: {formatNumber(score.totalPoints)} pts
            </p>
          </div>

          {score.newMilestone && (
            <div className="notice notice-ok">
              <p className="notice-title">
                <Trophy size={16} />
                ¡Alcanzaste el hito «{score.newMilestone.name}»!
              </p>
              {score.newMilestone.reward && <p>Recompensa: {score.newMilestone.reward}</p>}
            </div>
          )}

          {warnings.map((issue) => (
            <div className="notice notice-warn" key={issue.code}>
              <p>{describeIssue(issue)}</p>
            </div>
          ))}

          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="numeric">Unidades</th>
                  <th className="numeric">Pts por unidad</th>
                  <th className="numeric">Puntos</th>
                </tr>
              </thead>
              <tbody>
                {score.lines.map((line) => (
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
        </>
      )}

      <details className="stack-top">
        <summary>Ver texto extraído</summary>
        <pre>{result.text || '(no se detectó texto)'}</pre>
      </details>
    </article>
  );
}

/** A participant's view: where they stand in each campaign, and the scanner that moves them up. */
export function UserDashboard() {
  const [result, setResult] = useState<OcrResponse | null>(null);
  const [data, setData] = useState<MyCampaignsResponse | null>(null);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const loadCampaigns = useCallback(async (isCancelled: () => boolean = () => false) => {
    try {
      const next = await api.myCampaigns();
      if (isCancelled()) return;
      setData(next);
      setCampaignsError(null);
    } catch (cause) {
      if (!isCancelled()) {
        setCampaignsError(cause instanceof Error ? cause.message : 'No se pudieron cargar tus campañas');
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadCampaigns(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadCampaigns]);

  // Revoke the last preview URL whenever it's replaced or the page unmounts.
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const campaigns = data?.campaigns ?? [];
  const running = campaigns.filter((campaign) => isRunning(campaign));
  // Falls back to the first running campaign, so a user in just one never has to choose.
  const selected = running.find((campaign) => campaign.id === chosenId) ?? running[0] ?? null;
  const progressById = new Map((data?.progress ?? []).map((entry) => [entry.campaignId, entry]));

  async function processFile(file: File, campaignId: string) {
    setFileName(file.name);
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const nextPreview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
    previewUrlRef.current = nextPreview;
    setPreviewUrl(nextPreview);

    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const scanned = await api.ocr(file, campaignId);
      setResult(scanned);
      if (scanned.scoring.campaign) void loadCampaigns();
    } catch (cause) {
      setError(scanErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {campaigns.length > 0 && (
        <section className="panel-section">
          <h2>Tus campañas</h2>
          <div className="campaign-list">
            {campaigns.map((campaign) => (
              <CampaignCard
                key={campaign.id}
                campaign={campaign}
                progress={progressById.get(campaign.id)}
                productNames={data?.productNames ?? {}}
              />
            ))}
          </div>
        </section>
      )}

      <section className="panel-section">
        <h2>Escanear comprobante</h2>
        <p className="panel-section-hint">
          Elige la campaña y sube una foto o PDF de tu recibo o factura. Solo cuentan los productos de
          esa campaña que aparezcan con su precio, en un comprobante con total y con fecha dentro de la
          campaña.
        </p>

        {!data && !campaignsError && <p className="muted">Cargando tus campañas...</p>}
        {campaignsError && <p className="error">{campaignsError}</p>}

        {data && running.length === 0 && (
          <div className="notice notice-warn">
            <p>
              No tienes campañas vigentes. Podrás escanear comprobantes cuando una campaña en la que
              participas esté en curso.
            </p>
          </div>
        )}

        {selected && (
          <>
            <label className="scan-campaign-select">
              Campaña
              <select
                value={selected.id}
                disabled={busy}
                onChange={(event) => {
                  setChosenId(event.target.value);
                  setResult(null);
                  setError(null);
                }}
              >
                {running.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </select>
            </label>

            <FileDropzone
              accept="image/*,application/pdf"
              disabled={busy}
              fileName={fileName}
              previewUrl={previewUrl}
              onFile={(file) => void processFile(file, selected.id)}
            />
          </>
        )}

        {busy && <p className="muted stack-top">Leyendo el comprobante...</p>}
        {error && <p className="error stack-top">{error}</p>}
        {result && <ScanResult result={result} />}
      </section>
    </>
  );
}
