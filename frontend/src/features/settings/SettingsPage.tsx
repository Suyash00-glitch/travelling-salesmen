import { useState } from 'react';
import { Plus, Building2 } from 'lucide-react';
import { useLookups } from '../../hooks/useFactory';
import { Button } from '../../components/ui/button';
import { ActionForm, type FormSpec } from '../../components/shared/ActionForm';
import { PageHeader, Panel, Badge } from '../../components/shared/common';
import { DataTable } from '../../components/tables/DataTable';
import { label } from '../../lib/utils';
import { UserManagementTab } from './UserManagementTab';
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

  const openRecipeModal = () => {
    setSpec({
      title: 'Create fabric recipe',
      path: '/recipes',
      fields: [
        { name: 'name', label: 'Recipe name' },
        { name: 'material', label: 'Material type' },
        { name: 'specification', label: 'Yarn specification' },
        {
          name: 'kgPerMetre',
          label: 'Yarn kg per metre',
          type: 'number',
          min: 0.001,
          value: 0.2,
        },
        {
          name: 'wastePercent',
          label: 'Planned waste (%)',
          type: 'number',
          min: 0,
          max: 100,
          value: 3,
        },
        {
          name: 'overheadPerMetre',
          label: 'Overhead / metre (₹)',
          type: 'number',
          min: 0,
          value: 8,
        },
        {
          name: 'route',
          label: 'Manufacturing route',
          type: 'select',
          options: [
            { value: 'WEAVING,DYEING', label: 'Weaving → Dyeing' },
            {
              value: 'SPINNING,WEAVING,DYEING',
              label: 'Spinning → Weaving → Dyeing',
            },
            { value: 'WEAVING', label: 'Weaving only' },
            {
              value: 'SPINNING,WEAVING',
              label: 'Spinning → Weaving',
            },
          ],
        },
      ],
      transform: (d) => ({
        ...d,
        route: (d.route as string).split(','),
      }),
    });
  };

  const openBuyerModal = () => {
    setSpec({
      title: 'Add a buyer',
      path: '/buyers',
      fields: [
        { name: 'name', label: 'Company name' },
        { name: 'email', label: 'Email', type: 'email' },
        { name: 'city', label: 'City' },
      ],
    });
  };

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
              { accessorKey: 'kgPerMetre', header: 'kg / m' },
              { accessorKey: 'wastePercent', header: 'Waste %' },
              {
                id: 'route',
                header: 'Route',
                cell: ({ row }) =>
                  (row.original as { route: string[] }).route.map(label).join(' → '),
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
