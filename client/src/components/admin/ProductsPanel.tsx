import { useEffect, useState, type FormEvent } from 'react';
import { Package, Trash2 } from 'lucide-react';
import { api } from '../../services/api';
import type { Product } from '../../types/campaigns';

/**
 * The scoring table. Each product carries what one unit is worth by default;
 * a campaign can override that number for its own run.
 */
export function ProductsPanel() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [points, setPoints] = useState(1);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;

    api.admin
      .listProducts()
      .then((result) => {
        if (!cancelled) setProducts(result.products);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los productos');
        }
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
    setCreating(true);
    try {
      const created = await api.admin.createProduct({
        name,
        sku: sku.trim() || undefined,
        points,
        active: true,
      });
      setProducts((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
      setName('');
      setSku('');
      setPoints(1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo crear el producto');
    } finally {
      setCreating(false);
    }
  }

  async function patch(id: string, input: Partial<Product>) {
    setPendingId(id);
    setError(null);
    try {
      const updated = await api.admin.updateProduct(id, input);
      setProducts((current) => current.map((entry) => (entry.id === id ? updated : entry)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el producto');
    } finally {
      setPendingId(null);
    }
  }

  async function remove(product: Product) {
    if (!window.confirm(`¿Eliminar "${product.name}"? El historial de campañas conserva su propia copia.`)) return;

    setPendingId(product.id);
    setError(null);
    try {
      await api.admin.deleteProduct(product.id);
      setProducts((current) => current.filter((entry) => entry.id !== product.id));
    } catch (cause) {
      // The API refuses while a draft or active campaign still scores this product.
      setError(cause instanceof Error ? cause.message : 'No se pudo eliminar el producto');
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-text">
          <h1 className="page-header-title">Productos</h1>
          <p className="page-header-subtitle">
            Gestiona el catálogo de productos y los puntos que otorga cada uno.
          </p>
        </div>
      </div>

      <section className="panel-section">
        <h2>Agregar un producto</h2>
        <p className="panel-section-hint">Los puntos son lo que una unidad suma al total de un usuario.</p>

        <form className="inline-form" onSubmit={handleCreate}>
          <label>
            Nombre
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Widget azul"
              required
            />
          </label>

          <label>
            SKU (opcional)
            <input
              type="text"
              value={sku}
              onChange={(event) => setSku(event.target.value)}
              placeholder="BW-001"
            />
          </label>

          <label className="narrow">
            Puntos por unidad
            <input
              type="number"
              min={0}
              value={points}
              onChange={(event) => setPoints(Number(event.target.value))}
              required
            />
          </label>

          <button type="submit" disabled={creating}>
            {creating ? 'Agregando...' : 'Agregar producto'}
          </button>
        </form>
      </section>

      <section className="panel-section">
        <h2>Productos</h2>
        {loading && <p className="muted">Cargando...</p>}
        {error && <p className="error">{error}</p>}
        {!loading && products.length === 0 && (
          <div className="empty-state">
            <Package />
            <p>Aún no hay productos. Agrega el primero arriba.</p>
          </div>
        )}

        {products.length > 0 && (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>SKU</th>
                  <th>Puntos</th>
                  <th>Activo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {products.map((product) => {
                  const busy = pendingId === product.id;

                  return (
                    <tr key={product.id} className={product.active ? undefined : 'row-muted'}>
                      <td>{product.name}</td>
                      <td className="muted">{product.sku ?? '-'}</td>
                      <td>
                        <input
                          className="points-input"
                          type="number"
                          min={0}
                          defaultValue={product.points}
                          disabled={busy}
                          // Commit on blur so every keystroke is not a write.
                          onBlur={(event) => {
                            const next = Number(event.target.value);
                            if (next !== product.points) void patch(product.id, { points: next });
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={product.active}
                          disabled={busy}
                          onChange={(event) =>
                            void patch(product.id, { active: event.target.checked })
                          }
                        />
                      </td>
                      <td className="actions">
                        <button
                          type="button"
                          className="icon-btn danger"
                          disabled={busy}
                          onClick={() => void remove(product)}
                          aria-label={`Eliminar ${product.name}`}
                          title="Eliminar"
                        >
                          <Trash2 />
                        </button>
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
