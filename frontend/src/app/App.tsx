import type { ReactNode } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { can, type Area } from '@loomos/shared';
import { Workspace } from '../components/layout/Workspace';
import { useAuth } from '../features/auth/Auth';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { OrdersPage, OrderDetailsPage } from '../features/orders/OrdersPage';
import { InventoryPage } from '../features/inventory/InventoryPage';
import { ProcurementPage } from '../features/procurement/ProcurementPage';
import { ProductionPage } from '../features/production/ProductionPage';
import { BatchesPage } from '../features/production/BatchesPage';
import { MachinesPage } from '../features/machines/MachinesPage';
import { QualityPage, RollPassportPage } from '../features/quality/QualityPage';
import { DispatchPage } from '../features/dispatch/DispatchPage';
import { WorkforcePage } from '../features/workforce/WorkforcePage';
import { FinancePage } from '../features/finance/FinancePage';
import { ReportsPage } from '../features/reports/ReportsPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { BuyerPage } from '../features/buyer-portal/BuyerPage';
import { Empty } from '../components/shared/common';

function Guard({ area, children }: { area: Area; children: ReactNode }) {
  const { user } = useAuth();
  return can(user.role, area) ? (
    children
  ) : (
    <Empty
      title="This area is for another team"
      description="Your role doesn’t have access to this part of the workspace."
    />
  );
}

export function App() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route element={<Workspace />}>
        <Route
          index
          element={user.role === 'BUYER' ? <Navigate to="/buyer" replace /> : <DashboardPage />}
        />
        <Route
          path="orders"
          element={
            <Guard area="orders">
              <OrdersPage />
            </Guard>
          }
        />
        <Route
          path="orders/:id"
          element={
            <Guard area="orders">
              <OrderDetailsPage />
            </Guard>
          }
        />
        <Route
          path="inventory"
          element={
            <Guard area="inventory">
              <InventoryPage />
            </Guard>
          }
        />
        <Route
          path="procurement"
          element={
            <Guard area="procurement">
              <ProcurementPage />
            </Guard>
          }
        />
        <Route
          path="production"
          element={
            <Guard area="production">
              <ProductionPage />
            </Guard>
          }
        />
        <Route
          path="batches"
          element={
            <Guard area="production">
              <BatchesPage />
            </Guard>
          }
        />
        <Route
          path="machines"
          element={
            <Guard area="machines">
              <MachinesPage />
            </Guard>
          }
        />
        <Route
          path="quality"
          element={
            <Guard area="quality">
              <QualityPage />
            </Guard>
          }
        />
        <Route
          path="rolls"
          element={
            <Guard area="rolls">
              <QualityPage finished />
            </Guard>
          }
        />
        <Route path="rolls/:id" element={<RollPassportPage />} />
        <Route
          path="dispatch"
          element={
            <Guard area="dispatch">
              <DispatchPage />
            </Guard>
          }
        />
        <Route
          path="workforce"
          element={
            <Guard area="workforce">
              <WorkforcePage />
            </Guard>
          }
        />
        <Route
          path="finance"
          element={
            <Guard area="finance">
              <FinancePage />
            </Guard>
          }
        />
        <Route
          path="reports"
          element={
            <Guard area="reports">
              <ReportsPage />
            </Guard>
          }
        />
        <Route
          path="settings"
          element={
            <Guard area="settings">
              <SettingsPage />
            </Guard>
          }
        />
        <Route
          path="buyer"
          element={user.role === 'BUYER' ? <BuyerPage /> : <Navigate to="/" replace />}
        />
        <Route
          path="*"
          element={
            <Empty
              title="We couldn’t find that page"
              description="Use the workspace navigation to continue."
            />
          }
        />
      </Route>
    </Routes>
  );
}
