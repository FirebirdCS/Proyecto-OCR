import { useState } from 'react';
import { Link } from 'react-router-dom';
import { UsersPanel } from '../components/admin/UsersPanel';
import { ProductsPanel } from '../components/admin/ProductsPanel';
import { CampaignsPanel } from '../components/admin/CampaignsPanel';

const TABS = [
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'products', label: 'Products' },
  { id: 'users', label: 'Users' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/**
 * Everything an admin can do lives here: define the products that score, build
 * the campaign rules on top of them, and create the accounts that take part.
 * The route itself is admin-gated, and so is every endpoint behind it.
 */
export function AdminPage() {
  const [tab, setTab] = useState<TabId>('campaigns');

  return (
    <section className="card card-wide">
      <header className="row">
        <h1>Admin</h1>
        <Link to="/">Dashboard</Link>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={tab === entry.id ? 'tab tab-active' : 'tab'}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {tab === 'campaigns' && <CampaignsPanel />}
      {tab === 'products' && <ProductsPanel />}
      {tab === 'users' && <UsersPanel />}
    </section>
  );
}
