import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api, type OcrResponse } from '../services/api';
import { FileDropzone } from '../components/ui/FileDropzone';
import { ROLE_LABELS } from '../lib/labels';
import { getInitials } from '../lib/format';
import type { Campaign } from '../types/campaigns';

export function DashboardPage() {
  const { user, role } = useAuth();
  const [result, setResult] = useState<OcrResponse | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    api
      .myCampaigns()
      .then((response) => {
        if (!cancelled) setCampaigns(response.campaigns);
      })
      .catch(() => {
        // A missing campaign list should not break the OCR tool.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Revoke the last preview URL whenever it's replaced or the page unmounts.
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  async function processFile(file: File) {
    setFileName(file.name);
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const nextPreview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
    previewUrlRef.current = nextPreview;
    setPreviewUrl(nextPreview);

    setBusy(true);
    setError(null);
    try {
      setResult(await api.ocr(file));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'La subida falló');
    } finally {
      setBusy(false);
    }
  }

  const name = user?.displayName ?? user?.email ?? '';

  return (
    <div>
      <div className="page-header">
        <div className="page-header-text">
          <h1 className="page-header-title">Panel</h1>
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

      {campaigns.length > 0 && (
        <section className="panel-section">
          <h2>Tus campañas</h2>
          <div className="campaign-list">
            {campaigns.map((campaign) => (
              <article key={campaign.id} className="campaign-item">
                <div className="campaign-item-header">
                  <h3>{campaign.name}</h3>
                  <span className="badge">{campaign.milestones.length} hitos</span>
                </div>
                {campaign.description && <p className="muted">{campaign.description}</p>}

                <div className="milestone-timeline">
                  {campaign.milestones.map((milestone) => (
                    <div className="milestone-timeline-item" key={milestone.id}>
                      <span className="milestone-timeline-dot" />
                      <span className="milestone-timeline-name">{milestone.name}</span>
                      <span className="milestone-timeline-points">{milestone.targetPoints} pts</span>
                      {milestone.reward && (
                        <span className="milestone-timeline-reward">· {milestone.reward}</span>
                      )}
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="panel-section">
        <h2>Escanear documento</h2>
        <p className="panel-section-hint">
          Sube una foto o PDF de un recibo o factura para extraer su texto.
        </p>

        <FileDropzone
          accept="image/*,application/pdf"
          disabled={busy}
          fileName={fileName}
          previewUrl={previewUrl}
          onFile={(file) => void processFile(file)}
        />

        {busy && <p className="muted stack-top">Ejecutando OCR...</p>}
        {error && <p className="error stack-top">{error}</p>}

        {result && (
          <article className="stack-top">
            <h3>Texto extraído</h3>
            <pre>{result.text || '(no se detectó texto)'}</pre>
          </article>
        )}
      </section>
    </div>
  );
}
