import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppShell } from './components/layout/AppShell';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { ForbiddenPage } from './pages/ForbiddenPage';
import { CampaignsPanel } from './components/admin/CampaignsPanel';
import { ProductsPanel } from './components/admin/ProductsPanel';
import { UsersPanel } from './components/admin/UsersPanel';
import { ScansPanel } from './components/admin/ScansPanel';

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            {/* Any signed-in account. */}
            <Route element={<ProtectedRoute />}>
              <Route element={<AppShell />}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/forbidden" element={<ForbiddenPage />} />

                {/* Admins only. */}
                <Route element={<ProtectedRoute roles={['admin']} />}>
                  <Route path="/admin/campanas" element={<CampaignsPanel />} />
                  <Route path="/admin/productos" element={<ProductsPanel />} />
                  <Route path="/admin/comprobantes" element={<ScansPanel />} />
                  <Route path="/admin/usuarios" element={<UsersPanel />} />
                  <Route path="/admin" element={<Navigate to="/admin/campanas" replace />} />
                </Route>
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
