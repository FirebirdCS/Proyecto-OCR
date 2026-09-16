/**
 * Stands in for the admin dashboard on first load, shaped like the real thing
 * so nothing jumps when the numbers arrive. Later refreshes keep the previous
 * render on screen instead of coming back here.
 */
export function DashboardSkeleton() {
  return (
    <div aria-busy="true">
      <span className="sr-only" role="status">
        Cargando el panel…
      </span>

      <div className="kpi-grid" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="kpi-tile" key={index}>
            <span className="skeleton skeleton-text" style={{ width: '55%' }} />
            <span className="skeleton skeleton-value" />
            <span className="skeleton skeleton-text" style={{ width: '70%' }} />
          </div>
        ))}
      </div>

      <section className="panel-section" aria-hidden="true">
        <div className="section-header">
          <span className="skeleton skeleton-text" style={{ width: '12rem' }} />
          <span className="skeleton skeleton-control" />
        </div>
        <div className="skeleton skeleton-chart" />
      </section>

      <section className="panel-section" aria-hidden="true">
        <span className="skeleton skeleton-text" style={{ width: '10rem' }} />
        {Array.from({ length: 5 }, (_, index) => (
          <span key={index} className="skeleton skeleton-row" />
        ))}
      </section>
    </div>
  );
}
