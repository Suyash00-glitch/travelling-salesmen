import { useState } from 'react';
import { Plus, Building2 } from 'lucide-react';
import { useLookups } from '../../hooks/useFactory';
import { Button } from '../../components/ui/button';
import { ActionForm, type FormSpec } from '../../components/shared/ActionForm';
import { PageHeader, Panel, Badge } from '../../components/shared/common';
import { DataTable } from '../../components/tables/DataTable';
import { label, money } from '../../lib/utils';
import { UserManagementTab } from './UserManagementTab';
import { buyerForm, materialForm } from '../forms/quickForms';
import { RoleManagementTab } from './RoleManagementTab';
import { FactoryDepartmentTab } from './FactoryDepartmentTab';
import { AuditLogTab } from './AuditLogTab';

export function SettingsPage() {
  const [tab, setTab] = useState('Team access');
  const lookups = useLookups();
  const [spec, setSpec] = useState<FormSpec | null>(null);

  const tabs = [
    'Team access',
    'Roles & permissions',
    'Facilities & depts',
    'Fabric recipes',
    'Buyers',
    'Audit trail',
  ];

  const openRecipeModal = () => setSpec(materialForm());
  const openBuyerModal = () => setSpec(buyerForm());

  return (
    <>
      <PageHeader
        eyebrow="SUPER ADMIN CONTROL PANEL"
        title="Workspace settings"
        description="Manage team access, factory sites, fabric recipes and the activity history."
      />

      <div className="settings-summary">
        <span className="mill-avatar">
          <Building2 size={24} />
        </span>
        <div>
          <h2>Everest Textile Mills</h2>
          <p>Multi-unit operations · INR · Asia/Kolkata · Enterprise RBAC Active</p>
        </div>
        <Badge value="PASSED">RBAC Enabled</Badge>
      </div>

      <div className="tabs settings-tabs">
        {tabs.map((t) => (
          <button
            key={t}
            className={tab === t ? 'active' : ''}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Team access' && <UserManagementTab />}

      {tab === 'Roles & permissions' && <RoleManagementTab />}

      {tab === 'Facilities & depts' && <FactoryDepartmentTab />}

      {tab === 'Audit trail' && <AuditLogTab />}

      {tab === 'Fabric recipes' && (
        <Panel
          title="Recipes & production routes"
          subtitle="Material planning uses these per-fabric conversions; there is no universal kg-to-metre conversion."
          action={
            <Button size="sm" onClick={openRecipeModal}>
              <Plus size={14} />
              New recipe
            </Button>
          }
        >
          <DataTable
            data={lookups.data?.recipes ?? []}
            columns={[
              { accessorKey: 'name', header: 'Fabric recipe' },
              { accessorKey: 'material', header: 'Raw material' },
              { accessorKey: 'specification', header: 'Specification' },
              { accessorKey: 'pricePerMetre', header: 'Price / m', cell: ({ row }) => <strong>{money((row.original as { pricePerMetre: string }).pricePerMetre)}</strong> },
              { accessorKey: 'kgPerMetre', header: 'kg / m' },
              { accessorKey: 'wastePercent', header: 'Waste %' },
              {
                id: 'route',
                header: 'Route',
                cell: ({ row }) =>
                  (row.original as { route: string[] }).route.map(label).join(' → '),
              },
              {
                id: 'price',
                header: '',
                cell: ({ row }) => (
                  <Button size="sm" variant="outline" onClick={() => setSpec({
                    title: `Set price · ${(row.original as { name: string }).name}`,
                    description: 'Buyers see this price when ordering. Orders already placed keep their old price.',
                    path: `/recipes/${(row.original as { id: string }).id}/price`,
                    fields: [{ name: 'pricePerMetre', label: 'Price per metre (₹)', type: 'number', min: 0.01, value: Number((row.original as { pricePerMetre: string }).pricePerMetre) }],
                    submit: 'Save price',
                  })}>
                    Set price
                  </Button>
                ),
              },
            ]}
          />
        </Panel>
      )}

      {tab === 'Buyers' && (
        <Panel
          title="Buyer directory"
          action={
            <Button size="sm" onClick={openBuyerModal}>
              <Plus size={14} />
              Add buyer
            </Button>
          }
        >
          <DataTable
            data={lookups.data?.buyers ?? []}
            columns={[
              { accessorKey: 'name', header: 'Buyer name' },
              { accessorKey: 'email', header: 'Email' },
              { accessorKey: 'city', header: 'City' },
            ]}
          />
        </Panel>
      )}

      {spec && <ActionForm spec={spec} onClose={() => setSpec(null)} />}
    </>
  );
}
