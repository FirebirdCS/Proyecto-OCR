import { useState } from 'react';
import { formatBucket, formatNumber } from '../../lib/format';
import type { SalesBucket, SalesGranularity } from '../../types/scoring';

const TICKS = 4;

/** Every how many buckets an x label is printed; the rest are hidden on narrow screens. */
const LABEL_EVERY: Record<SalesGranularity, number> = { daily: 5, weekly: 2, monthly: 2 };

/** A clean step (1, 2, 5, 10, 20…) that fits `max` into TICKS rows. Units are whole numbers. */
function niceStep(max: number): number {
  const raw = Math.max(max / TICKS, 1);
  const power = 10 ** Math.floor(Math.log10(raw));
  const scaled = raw / power;
  const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return nice * power;
}

export interface SalesChartProps {
  buckets: SalesBucket[];
  granularity: SalesGranularity;
}

/**
 * Units sold per bucket, one series, so the section title names it and there is
 * no legend. Each bar is its own hover/focus target, and the same numbers sit
 * in a table below for anyone who cannot use the tooltip.
 */
export function SalesChart({ buckets, granularity }: SalesChartProps) {
  const [active, setActive] = useState<number | null>(null);

  const step = niceStep(Math.max(...buckets.map((bucket) => bucket.units), 0));
  const top = Math.ceil(Math.max(...buckets.map((bucket) => bucket.units), 1) / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step);
  const last = buckets.length - 1;
  const hovered = active === null ? null : buckets[active];

  // Keep the tooltip inside the plot near either edge.
  const tooltipShift =
    active === null ? '-50%' : active < buckets.length * 0.15 ? '0%' : active > buckets.length * 0.85 ? '-100%' : '-50%';

  return (
    <figure className="chart">
      <div className="chart-body">
        <div className="chart-y" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} style={{ bottom: `${(tick / top) * 100}%` }}>
              {formatNumber(tick)}
            </span>
          ))}
        </div>

        <div className="chart-plot" onMouseLeave={() => setActive(null)}>
          {ticks.map((tick) => (
            <span key={tick} className="chart-gridline" style={{ bottom: `${(tick / top) * 100}%` }} />
          ))}

          <div className="chart-bars">
            {buckets.map((bucket, index) => (
              <div
                key={bucket.key}
                className="chart-slot"
                data-active={active === index}
                role="img"
                tabIndex={0}
                aria-label={`${formatBucket(bucket.key, granularity, 'long')}: ${formatNumber(bucket.units)} unidades`}
                onMouseEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
              >
                <span
                  className="chart-bar"
                  style={{
                    height: bucket.units > 0 ? `max(2px, ${(bucket.units / top) * 100}%)` : 0,
                  }}
                />
              </div>
            ))}
          </div>

          {hovered && active !== null && (
            <div
              className="chart-tooltip"
              style={{
                left: `${((active + 0.5) / buckets.length) * 100}%`,
                transform: `translateX(${tooltipShift})`,
              }}
            >
              <strong>{formatNumber(hovered.units)} unidades</strong>
              <span>{formatBucket(hovered.key, granularity, 'long')}</span>
              <span>
                {formatNumber(hovered.points)} pts · {formatNumber(hovered.receipts)} comprobantes
              </span>
            </div>
          )}
        </div>

        <span />
        <div className="chart-x" aria-hidden="true">
          {buckets.map((bucket, index) => {
            // Count back from the newest bucket so the current period is always labelled.
            const labelled = (last - index) % LABEL_EVERY[granularity] === 0;
            const major = (last - index) % (LABEL_EVERY[granularity] * 2) === 0;
            return (
              <span key={bucket.key} className={major ? 'chart-x-cell' : 'chart-x-cell chart-x-cell--minor'}>
                {labelled && <span>{formatBucket(bucket.key, granularity, 'short')}</span>}
              </span>
            );
          })}
        </div>
      </div>

      <details className="chart-table">
        <summary>Ver datos en tabla</summary>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Periodo</th>
                <th>Unidades</th>
                <th>Puntos</th>
                <th>Comprobantes</th>
              </tr>
            </thead>
            <tbody>
              {[...buckets].reverse().map((bucket) => (
                <tr key={bucket.key}>
                  <td>{formatBucket(bucket.key, granularity, 'long')}</td>
                  <td className="numeric">{formatNumber(bucket.units)}</td>
                  <td className="numeric">{formatNumber(bucket.points)}</td>
                  <td className="numeric">{formatNumber(bucket.receipts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
