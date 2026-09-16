import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { BarChart3, CalendarDays, CalendarRange, Package, RefreshCw, ShoppingBag } from 'lucide-react';
import { api } from '../../services/api';
import { formatNumber } from '../../lib/format';
import type { DashboardStats, SalesBucket, SalesGranularity } from '../../types/scoring';
import { DashboardSkeleton } from './DashboardSkeleton';
import { SalesChart } from './SalesChart';

const GRANULARITIES: { id: SalesGranularity; label: string; window: string }[] = [
  { id: 'daily', label: 'Por día', window: 'últimos 30 días' },
  { id: 'weekly', label: 'Por semana', window: 'últimas 12 semanas' },
  { id: 'monthly', label: 'Por mes', window: 'últimos 12 meses' },
];

function KpiTile({ icon, label, value, meta }: { icon: ReactNode; label: string; value: string; meta: string }) {
  return (
    <div className="kpi-tile">
      <span className="kpi-tile-label">
        {icon}
        {label}
      </span>
      <span className="kpi-tile-value">{value}</span>
      <span className="kpi-tile-meta">{meta}</span>
    </div>
  );
}

function salesMeta(bucket: SalesBucket | undefined): string {
  if (!bucket) return 'Sin datos';
  return `${formatNumber(bucket.receipts)} comprobantes · ${formatNumber(bucket.points)} pts`;
}

/**
 * The admin's landing page: how big the catalog is and how much of it is
 * selling, per day, week and month. Sales only count once a user's receipt has
 * been scanned and matched against a running campaign.
 */
export function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [granularity, setGranularity] = useState<SalesGranularity>('daily');

  const load = useCallback(async (isCancelled: () => boolean = () => false) => {
    setRefreshing(true);
    try {
      const next = await api.admin.dashboard();
      if (isCancelled()) return;
      setStats(next);
      setError(null);
    } catch (cause) {
      if (!isCancelled()) {
        setError(cause instanceof Error ? cause.message : 'No se pudo cargar el panel');
      }
    } finally {
      if (!isCancelled()) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  if (!stats) {
    if (!error) return <DashboardSkeleton />;

    return (
      <section className="panel-section">
        <p className="error">{error}</p>
        <button type="button" className="ghost stack-top" disabled={refreshing} onClick={() => void load()}>
          <RefreshCw size={15} />
          Reintentar
        </button>
      </section>
    );
  }

  const current = GRANULARITIES.find((entry) => entry.id === granularity)!;
  const series = stats.series[granularity];
  const windowUnits = series.reduce((sum, bucket) => sum + bucket.units, 0);
  const topProducts = stats.topProducts[granularity];

  return (
    <div className={refreshing ? 'is-refreshing' : undefined} aria-busy={refreshing}>
      <div className="kpi-grid">
        <KpiTile
          icon={<Package />}
          label="Productos registrados"
          value={formatNumber(stats.products.total)}
          meta={`${formatNumber(stats.products.active)} activos · ${formatNumber(stats.activeCampaigns)} campañas activas`}
        />
        <KpiTile
          icon={<ShoppingBag />}
          label="Vendidos hoy"
          value={formatNumber(stats.series.daily.at(-1)?.units ?? 0)}
          meta={salesMeta(stats.series.daily.at(-1))}
        />
        <KpiTile
          icon={<CalendarRange />}
          label="Vendidos esta semana"
          value={formatNumber(stats.series.weekly.at(-1)?.units ?? 0)}
          meta={salesMeta(stats.series.weekly.at(-1))}
        />
        <KpiTile
          icon={<CalendarDays />}
          label="Vendidos este mes"
          value={formatNumber(stats.series.monthly.at(-1)?.units ?? 0)}
          meta={salesMeta(stats.series.monthly.at(-1))}
        />
      </div>

      {error && <p className="error">{error}</p>}

      <section className="panel-section">
        <div className="section-header">
          <div>
            <h2>Unidades vendidas</h2>
            <p className="panel-section-hint">
              {formatNumber(windowUnits)} unidades en los {current.window}.
            </p>
          </div>

          <div className="section-header-actions">
            <div className="segmented" role="group" aria-label="Agrupar ventas">
              {GRANULARITIES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={granularity === entry.id}
                  onClick={() => setGranularity(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="icon-btn"
              disabled={refreshing}
              onClick={() => void load()}
              aria-label="Actualizar"
              title="Actualizar"
            >
              <RefreshCw />
            </button>
          </div>
        </div>

        {windowUnits === 0 ? (
          <div className="empty-state">
            <BarChart3 />
            <p>Aún no hay ventas registradas en este periodo. Aparecerán cuando los usuarios escaneen sus comprobantes.</p>
          </div>
        ) : (
          <SalesChart buckets={series} granularity={granularity} />
        )}
      </section>

      <section className="panel-section">
        <h2>Productos más vendidos</h2>
        <p className="panel-section-hint">En los {current.window}.</p>

        {topProducts.length === 0 ? (
          <div className="empty-state">
            <Package />
            <p>Todavía no hay productos vendidos en este periodo.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="numeric">Unidades</th>
                  <th className="numeric">Puntos otorgados</th>
                  <th>Participación</th>
                </tr>
              </thead>
              <tbody>
                {topProducts.map((product) => {
                  const share = windowUnits > 0 ? product.units / windowUnits : 0;
                  return (
                    <tr key={product.productId}>
                      <td>{product.name}</td>
                      <td className="numeric">{formatNumber(product.units)}</td>
                      <td className="numeric">{formatNumber(product.points)}</td>
                      <td>
                        <span className="share">
                          <span className="share-track">
                            <span className="share-fill" style={{ width: `${share * 100}%` }} />
                          </span>
                          <span className="share-value">{Math.round(share * 100)}%</span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="dashboard-footnote">
        Ventas agrupadas por día en la zona horaria {stats.timeZone}. Actualizado a las{' '}
        {new Date(stats.generatedAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}.
      </p>
    </div>
  );
}
