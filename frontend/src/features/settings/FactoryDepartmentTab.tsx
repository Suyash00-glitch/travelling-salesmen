import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Building2,
  Layers,
  Plus,
  Users,
  MapPin,
} from 'lucide-react';
import { type FactoryItem, type DepartmentItem } from '@loomos/shared';
import { useData } from '../../hooks/useFactory';
import { api } from '../../services/api';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/dialog';
import { Badge, Panel, Spinner } from '../../components/shared/common';
import { DataTable } from '../../components/tables/DataTable';

export function FactoryDepartmentTab() {
  const client = useQueryClient();
  const [createFactoryOpen, setCreateFactoryOpen] = useState(false);
  const [createDeptOpen, setCreateDeptOpen] = useState(false);

  const factoriesQuery = useData<FactoryItem[]>('/rbac/factories');
  const deptsQuery = useData<DepartmentItem[]>('/rbac/departments');

  const factories = factoriesQuery.data ?? [];
  const departments = deptsQuery.data ?? [];

  const [factoryForm, setFactoryForm] = useState({
    code: '',
    name: '',
    location: '',
  });

  const [deptForm, setDeptForm] = useState({
    code: '',
    name: '',
    factoryId: '',
  });

  const createFactory = useMutation({
    mutationFn: (data: typeof factoryForm) =>
      api<FactoryItem>('/rbac/factories', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['/rbac/factories'] });
      setCreateFactoryOpen(false);
      setFactoryForm({ code: '', name: '', location: '' });
      toast.success('Facility created successfully.');
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const createDept = useMutation({
    mutationFn: (data: typeof deptForm) =>
      api<DepartmentItem>('/rbac/departments', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['/rbac/departments'] });
      setCreateDeptOpen(false);
      setDeptForm({ code: '', name: '', factoryId: '' });
      toast.success('Department created successfully.');
    },
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <>
      {/* Overview Stat Strip */}
      <div className="summary-strip">
        <div>
          <Building2 size={20} />
          <span>
            <strong>{factories.length}</strong>Operating sites
          </span>
        </div>
        <div>
          <Layers size={20} />
          <span>
            <strong>{departments.length}</strong>Production units
          </span>
        </div>
        <div>
          <Users size={20} />
          <span>
            <strong>
              {factories.reduce((acc, f) => acc + (f.userCount || 0), 0)}
            </strong>
            Scoped personnel
          </span>
        </div>
      </div>

      {/* Facilities Section */}
      <Panel
        title="Manufacturing Facilities"
        subtitle="Manage factories, spinning & weaving units, and processing centers."
        action={
          <Button size="sm" onClick={() => setCreateFactoryOpen(true)}>
            <Plus size={14} /> New facility
          </Button>
        }
      >
        {factoriesQuery.isPending ? (
          <Spinner />
        ) : (
          <div className="facility-grid">
            {factories.map((f) => (
              <div key={f.id} className="facility-card">
                <div className="facility-header">
                  <div className="facility-title">
                    <span className="entity-icon">
                      <Building2 size={18} />
                    </span>
                    <strong>{f.name}</strong>
                  </div>
                  <Badge value={f.active ? 'PASSED' : 'OFFLINE'}>
                    {f.active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>

                <div className="facility-location">
                  <MapPin size={14} />
                  <span>{f.location || 'Surat Industrial Zone, Gujarat'}</span>
                </div>

                <div className="facility-meta">
                  <span>
                    Code: <strong>{f.code}</strong>
                  </span>
                  <div className="facility-tags">
                    <span>{f.departmentCount || 0} units</span>
                    <span>{f.userCount || 0} staff</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Departments Section */}
      <Panel
        title="Departments & Stages"
        subtitle="Department-level access scopes operators, supervisors, and floor machines."
        action={
          <Button
            size="sm"
            onClick={() => {
              if (factories.length > 0) {
                setDeptForm((prev) => ({ ...prev, factoryId: factories[0].id }));
              }
              setCreateDeptOpen(true);
            }}
          >
            <Plus size={14} /> New department
          </Button>
        }
      >
        {deptsQuery.isPending ? (
          <Spinner />
        ) : (
          <DataTable
            data={departments}
            columns={[
              {
                accessorKey: 'name',
                header: 'Department name',
                cell: ({ row }) => (
                  <div className="buyer-cell">
                    <span className="entity-icon">
                      <Layers size={16} />
                    </span>
                    <div className="cell-stack">
                      <strong>{row.original.name}</strong>
                      <span className="muted">{row.original.factoryName}</span>
                    </div>
                  </div>
                ),
              },
              {
                accessorKey: 'code',
                header: 'Code',
                cell: ({ row }) => (
                  <code className="audit-code">{row.original.code}</code>
                ),
              },
              {
                accessorKey: 'factoryName',
                header: 'Parent facility',
              },
              {
                accessorKey: 'userCount',
                header: 'Personnel',
                cell: ({ row }) => (
                  <span className="tabular font-medium">
                    {row.original.userCount || 0} staff
                  </span>
                ),
              },
              {
                accessorKey: 'active',
                header: 'Status',
                cell: ({ row }) => (
                  <Badge value={row.original.active ? 'PASSED' : 'OFFLINE'}>
                    {row.original.active ? 'Active' : 'Inactive'}
                  </Badge>
                ),
              },
            ]}
          />
        )}
      </Panel>

      {/* Create Factory Modal */}
      {createFactoryOpen && (
        <Modal
          open={createFactoryOpen}
          onClose={() => setCreateFactoryOpen(false)}
          title="Create Manufacturing Facility"
          description="Configure a new manufacturing site, weaving shed, or processing plant."
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createFactory.mutate(factoryForm);
            }}
          >
            <div className="form-grid">
              <label className="field">
                <span>Facility Code *</span>
                <input
                  type="text"
                  required
                  placeholder="e.g. ETM-02"
                  value={factoryForm.code}
                  onChange={(e) =>
                    setFactoryForm({
                      ...factoryForm,
                      code: e.target.value.toUpperCase(),
                    })
                  }
                />
              </label>

              <label className="field">
                <span>Facility Name *</span>
                <input
                  type="text"
                  required
                  placeholder="e.g. Everest Weaving Unit II"
                  value={factoryForm.name}
                  onChange={(e) =>
                    setFactoryForm({ ...factoryForm, name: e.target.value })
                  }
                />
              </label>

              <label className="field col-span-2">
                <span>Location / City *</span>
                <input
                  type="text"
                  required
                  placeholder="e.g. Surat, Gujarat"
                  value={factoryForm.location}
                  onChange={(e) =>
                    setFactoryForm({ ...factoryForm, location: e.target.value })
                  }
                />
              </label>
            </div>

            <div className="dialog-footer">
              <Button
                variant="outline"
                type="button"
                onClick={() => setCreateFactoryOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createFactory.isPending}>
                {createFactory.isPending ? 'Creating…' : 'Create facility'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Create Department Modal */}
      {createDeptOpen && (
        <Modal
          open={createDeptOpen}
          onClose={() => setCreateDeptOpen(false)}
          title="Create Facility Department"
          description="Configure a dedicated unit or shopfloor department."
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createDept.mutate(deptForm);
            }}
          >
            <div className="form-grid">
              <label className="field col-span-2">
                <span>Parent Facility *</span>
                <select
                  required
                  value={deptForm.factoryId}
                  onChange={(e) =>
                    setDeptForm({ ...deptForm, factoryId: e.target.value })
                  }
                >
                  <option value="">Select facility...</option>
                  {factories.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({f.code})
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Department Code *</span>
                <input
                  type="text"
                  required
                  placeholder="e.g. FIN-01"
                  value={deptForm.code}
                  onChange={(e) =>
                    setDeptForm({
                      ...deptForm,
                      code: e.target.value.toUpperCase(),
                    })
                  }
                />
              </label>

              <label className="field">
                <span>Department Name *</span>
                <input
                  type="text"
                  required
                  placeholder="e.g. Quality & Lab"
                  value={deptForm.name}
                  onChange={(e) =>
                    setDeptForm({ ...deptForm, name: e.target.value })
                  }
                />
              </label>
            </div>

            <div className="dialog-footer">
              <Button
                variant="outline"
                type="button"
                onClick={() => setCreateDeptOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createDept.isPending}>
                {createDept.isPending ? 'Creating…' : 'Create department'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
