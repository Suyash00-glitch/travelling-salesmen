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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Overview Stat Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1rem',
        }}
      >
        <div
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            padding: '1.25rem',
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: '8px',
              background: 'rgba(59, 130, 246, 0.12)',
              color: '#3b82f6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Building2 size={24} />
          </div>
          <div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--muted)' }}>Total Facilities</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{factories.length}</div>
          </div>
        </div>

        <div
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            padding: '1.25rem',
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: '8px',
              background: 'rgba(16, 185, 129, 0.12)',
              color: '#10b981',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Layers size={24} />
          </div>
          <div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--muted)' }}>Departments</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{departments.length}</div>
          </div>
        </div>

        <div
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            padding: '1.25rem',
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: '8px',
              background: 'rgba(245, 158, 11, 0.12)',
              color: '#f59e0b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Users size={24} />
          </div>
          <div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--muted)' }}>Scoped Users</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>
              {factories.reduce((acc, f) => acc + (f.userCount || 0), 0)}
            </div>
          </div>
        </div>
      </div>

      {/* Facilities Section */}
      <Panel
        title="Manufacturing Facilities"
        subtitle="Manage factories, spinning & weaving units, and processing centers."
        action={
          <Button size="sm" onClick={() => setCreateFactoryOpen(true)}>
            <Plus size={14} /> New Facility
          </Button>
        }
      >
        {factoriesQuery.isPending ? (
          <Spinner />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
              gap: '1rem',
            }}
          >
            {factories.map((f) => (
              <div
                key={f.id}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: '10px',
                  padding: '1.25rem',
                  background: 'var(--surface, rgba(255,255,255,0.02))',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Building2 size={18} color="var(--accent)" />
                    <span style={{ fontWeight: 600, fontSize: '1rem' }}>{f.name}</span>
                  </div>
                  <Badge value={f.active ? 'PASSED' : 'OFFLINE'}>
                    {f.active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: 'var(--muted)', fontSize: '0.8125rem' }}>
                  <MapPin size={14} />
                  <span>{f.location || 'Surat Industrial Zone, Gujarat'}</span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingTop: '0.75rem',
                    borderTop: '1px solid var(--border)',
                    fontSize: '0.8125rem',
                    color: 'var(--muted)',
                  }}
                >
                  <span>Code: <strong>{f.code}</strong></span>
                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <span>{f.departmentCount || 0} Departments</span>
                    <span>{f.userCount || 0} Staff</span>
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
            <Plus size={14} /> New Department
          </Button>
        }
      >
        {deptsQuery.isPending ? (
          <Spinner />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th>Department Name</th>
                  <th>Code</th>
                  <th>Facility</th>
                  <th>Assigned Personnel</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {departments.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Layers size={16} color="var(--muted)" />
                        <strong>{d.name}</strong>
                      </div>
                    </td>
                    <td>
                      <code style={{ fontSize: '0.8125rem', padding: '2px 6px', background: 'rgba(255,255,255,0.06)', borderRadius: '4px' }}>
                        {d.code}
                      </code>
                    </td>
                    <td>{d.factoryName}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                        <Users size={14} color="var(--muted)" />
                        <span>{d.userCount || 0} users</span>
                      </div>
                    </td>
                    <td>
                      <Badge value={d.active ? 'PASSED' : 'OFFLINE'}>
                        {d.active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
          <div style={{ padding: '0.5rem 0' }}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createFactory.mutate(factoryForm);
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
            >
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                  Facility Code
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. ETM-02"
                  value={factoryForm.code}
                  onChange={(e) => setFactoryForm({ ...factoryForm, code: e.target.value.toUpperCase() })}
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--input-bg, transparent)' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                  Facility Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Everest Weaving Unit II"
                  value={factoryForm.name}
                  onChange={(e) => setFactoryForm({ ...factoryForm, name: e.target.value })}
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--input-bg, transparent)' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                  Location / City
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Surat, Gujarat"
                  value={factoryForm.location}
                  onChange={(e) => setFactoryForm({ ...factoryForm, location: e.target.value })}
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--input-bg, transparent)' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                <Button variant="ghost" type="button" onClick={() => setCreateFactoryOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createFactory.isPending}>
                  {createFactory.isPending ? 'Creating...' : 'Create Facility'}
                </Button>
              </div>
            </form>
          </div>
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
          <div style={{ padding: '0.5rem 0' }}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createDept.mutate(deptForm);
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
            >
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                  Parent Facility
                </label>
                <select
                  required
                  value={deptForm.factoryId}
                  onChange={(e) => setDeptForm({ ...deptForm, factoryId: e.target.value })}
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--input-bg, transparent)' }}
                >
                  <option value="">Select facility...</option>
                  {factories.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({f.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                  Department Code
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. FIN-01"
                  value={deptForm.code}
                  onChange={(e) => setDeptForm({ ...deptForm, code: e.target.value.toUpperCase() })}
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--input-bg, transparent)' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                  Department Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Quality & Lab"
                  value={deptForm.name}
                  onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })}
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--input-bg, transparent)' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                <Button variant="ghost" type="button" onClick={() => setCreateDeptOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createDept.isPending}>
                  {createDept.isPending ? 'Creating...' : 'Create Department'}
                </Button>
              </div>
            </form>
          </div>
        </Modal>
      )}
    </div>
  );
}
