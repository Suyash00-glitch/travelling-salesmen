import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus,
  UserPlus,
  Edit2,
  CheckCircle2,
  XCircle,
  Search,
} from 'lucide-react';
import {
  type PageResponse,
  type UserManagementItem,
  type RoleDetail,
  type FactoryItem,
  type DepartmentItem,
  standardRoles,
} from '@loomos/shared';
import { useData, useLookups } from '../../hooks/useFactory';
import { ActionForm, type FormSpec } from '../../components/shared/ActionForm';
import { api } from '../../services/api';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/dialog';
import { Badge, Panel, Spinner } from '../../components/shared/common';
import { label } from '../../lib/utils';

export function UserManagementTab() {
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const [createModal, setCreateModal] = useState(false);
  const [editUser, setEditUser] = useState<UserManagementItem | null>(null);

  const usersQuery = useData<PageResponse<UserManagementItem>>('/rbac/users?pageSize=200');
  const rolesQuery = useData<RoleDetail[]>('/rbac/roles');
  const factoriesQuery = useData<FactoryItem[]>('/rbac/factories');
  const deptsQuery = useData<DepartmentItem[]>('/rbac/departments');

  // Toggle user active status
  const toggleStatus = useMutation({
    mutationFn: (userId: string) =>
      api<{ id: string; active: boolean }>(`/rbac/users/${userId}/toggle-status`, {}),
    onSuccess: (data) => {
      void client.invalidateQueries({ queryKey: ['/rbac/users'] });
      toast.success(data.active ? 'Account activated.' : 'Account suspended.');
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const lookups = useLookups();
  const [spec, setSpec] = useState<FormSpec | null>(null);
  const everyone = usersQuery.data?.data ?? [];
  const pending = everyone.filter((u) => u.approvalStatus === 'PENDING');
  // Pending requests are handled in the card above the table, not with the activate switch.
  const allUsers = everyone.filter((u) => u.approvalStatus !== 'PENDING');

  const approve = (u: UserManagementItem): FormSpec => ({
    title: `Approve ${u.name}`,
    description: `${u.email} asked for ${u.requestedRole ? label(u.requestedRole) : 'access'}. Choose the role they should really have.`,
    path: `/rbac/users/${u.id}/approve`,
    fields: [
      {
        name: 'role',
        label: 'Role',
        type: 'select',
        value: u.requestedRole ?? '',
        options: (rolesQuery.data ?? []).map((r) => ({ value: r.code, label: r.name })),
      },
      {
        name: 'buyerId',
        label: 'Buyer company (buyers only)',
        type: 'select',
        required: false,
        options: (lookups.data?.buyers ?? []).map((b) => ({ value: b.id, label: b.name })),
        hint: u.company ? `Leave empty to create “${u.company}, ${u.city}” from the signup.` : undefined,
      },
      {
        name: 'departmentId',
        label: 'Department',
        type: 'select',
        required: false,
        options: (deptsQuery.data ?? []).map((d) => ({ value: d.id, label: d.name })),
      },
      {
        name: 'workerId',
        label: 'Linked worker record',
        type: 'select',
        required: false,
        options: (lookups.data?.workers ?? []).map((w) => ({ value: w.id, label: w.name })),
        hint: 'Floor staff: lets them accept jobs as themselves.',
      },
    ],
    transform: (d) => Object.fromEntries(Object.entries(d).filter(([, v]) => v !== '')),
    submit: 'Approve and give access',
  });

  const reject = (u: UserManagementItem): FormSpec => ({
    title: `Decline ${u.name}`,
    description: 'They will not be able to sign in.',
    path: `/rbac/users/${u.id}/reject`,
    fields: [{ name: 'reason', label: 'Reason', type: 'textarea', span: true }],
    submit: 'Decline request',
  });

  const filteredUsers = allUsers.filter((u) => {
    const matchesSearch =
      `${u.name} ${u.email} ${u.role}`.toLowerCase().includes(search.toLowerCase());
    const matchesRole = roleFilter === 'ALL' || u.roles.includes(roleFilter) || u.role === roleFilter;
    const matchesStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'ACTIVE' && u.active) ||
      (statusFilter === 'SUSPENDED' && !u.active);
    return matchesSearch && matchesRole && matchesStatus;
  });

  return (
    <>
      {pending.length > 0 && (
        <div className="approval-card">
          <h3>Access requests waiting for you ({pending.length})</h3>
          {pending.map((u) => (
            <div className="approval-row" key={u.id}>
              <div>
                <strong>{u.name}</strong> · {u.email}
                <p>
                  Asked for {u.requestedRole ? label(u.requestedRole) : 'access'}
                  {u.company ? ` · ${u.company}, ${u.city}` : ''}
                  {u.phone ? ` · ${u.phone}` : ''}
                  {` · ${new Date(u.createdAt).toLocaleDateString('en-IN')}`}
                </p>
                {u.note && <p>“{u.note}”</p>}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <Button size="sm" onClick={() => setSpec(approve(u))}>
                  <CheckCircle2 size={14} /> Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => setSpec(reject(u))}>
                  <XCircle size={14} /> Decline
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {spec && <ActionForm spec={spec} onClose={() => setSpec(null)} />}

      <Panel
        title="User & Account Administration"
        subtitle="Control user logins, assign multiple roles, link factory departments, and suspend accounts."
        action={
          <Button size="sm" onClick={() => setCreateModal(true)}>
            <UserPlus size={15} />
            Create user
          </Button>
        }
      >
        <div className="table-toolbar">
          <div className="search-box">
            <Search size={16} />
            <input
              placeholder="Search users by name, email or role…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="flex gap-2 items-center flex-wrap">
            <select
              className="text-xs p-1.5 border rounded bg-white border-stone-200"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              <option value="ALL">All roles</option>
              {standardRoles.map((r) => (
                <option key={r} value={r}>
                  {label(r)}
                </option>
              ))}
            </select>

            <select
              className="text-xs p-1.5 border rounded bg-white border-stone-200"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">All status</option>
              <option value="ACTIVE">Active only</option>
              <option value="SUSPENDED">Suspended only</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Primary role</th>
                <th>Assigned roles</th>
                <th>Factory & Department</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u) => (
                <tr key={u.id} className={!u.active ? 'opacity-60 bg-stone-50' : ''}>
                  <td>
                    <div className="cell-stack">
                      <strong>{u.name}</strong>
                      <span className="text-xs muted">{u.email}</span>
                    </div>
                  </td>
                  <td>
                    <Badge value={u.role} />
                  </td>
                  <td>
                    <div className="flex gap-1 flex-wrap max-w-xs">
                      {u.roles.map((r) => (
                        <span
                          key={r}
                          className="text-[11px] px-1.5 py-0.5 rounded bg-stone-100 border border-stone-200"
                        >
                          {label(r)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className="cell-stack text-xs">
                      <span>{u.factoryName ?? 'All factories'}</span>
                      <small className="muted">{u.departmentName ?? 'General'}</small>
                    </div>
                  </td>
                  <td>
                    {u.approvalStatus === 'REJECTED' ? (
                      <Badge value="REJECTED">Signup declined</Badge>
                    ) : (
                      <Badge value={u.active ? 'PASSED' : 'OFFLINE'}>
                        {u.active ? 'Active' : 'Suspended'}
                      </Badge>
                    )}
                  </td>
                  <td>
                    <div className="flex gap-1.5 items-center">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditUser(u)}
                        title="Edit user details & roles"
                      >
                        <Edit2 size={13} />
                        Edit
                      </Button>

                      {u.approvalStatus === 'APPROVED' && <Button
                        size="sm"
                        variant={u.active ? 'outline' : 'default'}
                        onClick={() => toggleStatus.mutate(u.id)}
                        disabled={toggleStatus.isPending}
                        title={u.active ? 'Suspend account' : 'Activate account'}
                      >
                        {u.active ? <XCircle size={13} /> : <CheckCircle2 size={13} />}
                        {u.active ? 'Suspend' : 'Activate'}
                      </Button>}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-6 muted">
                    No matching user accounts found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* CREATE USER MODAL */}
      {createModal && (
        <CreateUserModal
          roles={rolesQuery.data ?? []}
          factories={factoriesQuery.data ?? []}
          departments={deptsQuery.data ?? []}
          onClose={() => setCreateModal(false)}
        />
      )}

      {/* EDIT USER MODAL */}
      {editUser && (
        <EditUserModal
          user={editUser}
          roles={rolesQuery.data ?? []}
          factories={factoriesQuery.data ?? []}
          departments={deptsQuery.data ?? []}
          onClose={() => setEditUser(null)}
        />
      )}
    </>
  );
}

// ----------------- CREATE USER MODAL -----------------
function CreateUserModal({
  roles,
  factories,
  departments,
  onClose,
}: {
  roles: RoleDetail[];
  factories: FactoryItem[];
  departments: DepartmentItem[];
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('LoomDemo2026!');
  const [primaryRole, setPrimaryRole] = useState('WEAVING_OPERATOR');
  const [selectedRoles, setSelectedRoles] = useState<string[]>(['WEAVING_OPERATOR']);
  const [factoryId, setFactoryId] = useState('');
  const [departmentId, setDepartmentId] = useState('');

  const create = useMutation({
    mutationFn: (body: unknown) => api('/rbac/users', body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['/rbac/users'] });
      toast.success('User account created successfully.');
      onClose();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const toggleRoleSelection = (code: string) => {
    setSelectedRoles((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate({
      name,
      email,
      password,
      role: primaryRole,
      roles: Array.from(new Set([primaryRole, ...selectedRoles])),
      factoryId: factoryId || undefined,
      departmentId: departmentId || undefined,
      active: true,
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Create User Account"
      description="Register a new employee account with assigned factory and granular role boundaries."
      wide
    >
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <label className="field">
            <span>Full Name *</span>
            <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rahul Sharma" />
          </label>

          <label className="field">
            <span>Email Address *</span>
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="e.g. rahul@loomos.demo" />
          </label>

          <label className="field">
            <span>Initial Password *</span>
            <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>

          <label className="field">
            <span>Primary Role *</span>
            <select
              value={primaryRole}
              onChange={(e) => {
                setPrimaryRole(e.target.value);
                if (!selectedRoles.includes(e.target.value)) {
                  setSelectedRoles((prev) => [...prev, e.target.value]);
                }
              }}
            >
              {roles.map((r) => (
                <option key={r.id} value={r.code}>
                  {r.name} ({r.code})
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Assigned Factory</span>
            <select value={factoryId} onChange={(e) => setFactoryId(e.target.value)}>
              <option value="">All / Global Facility</option>
              {factories.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} ({f.code})
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Assigned Department</span>
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">All / General</option>
              {departments
                .filter((d) => !factoryId || d.factoryId === factoryId)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.code})
                  </option>
                ))}
            </select>
          </label>
        </div>

        <div className="mt-4">
          <span className="text-xs font-semibold uppercase text-stone-600">
            Multiple Roles (Check all that apply)
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2 p-3 border rounded bg-stone-50 border-stone-200">
            {roles.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedRoles.includes(r.code)}
                  onChange={() => toggleRoleSelection(r.code)}
                />
                <span>{r.name}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="dialog-footer mt-5">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={create.isPending}>
            {create.isPending ? <Spinner /> : <Plus size={15} />}
            Create account
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ----------------- EDIT USER MODAL -----------------
function EditUserModal({
  user,
  roles,
  factories,
  departments,
  onClose,
}: {
  user: UserManagementItem;
  roles: RoleDetail[];
  factories: FactoryItem[];
  departments: DepartmentItem[];
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [name, setName] = useState(user.name);
  const [primaryRole, setPrimaryRole] = useState(user.role);
  const [selectedRoles, setSelectedRoles] = useState<string[]>(user.roles);
  const [factoryId, setFactoryId] = useState(user.factoryId ?? '');
  const [departmentId, setDepartmentId] = useState(user.departmentId ?? '');
  const [newPassword, setNewPassword] = useState('');

  const update = useMutation({
    mutationFn: (body: unknown) => api(`/rbac/users/${user.id}`, body, 'PATCH'),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['/rbac/users'] });
      toast.success('User updated successfully.');
      onClose();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const toggleRoleSelection = (code: string) => {
    setSelectedRoles((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    update.mutate({
      name,
      role: primaryRole,
      roles: Array.from(new Set([primaryRole, ...selectedRoles])),
      factoryId: factoryId || null,
      departmentId: departmentId || null,
      password: newPassword || undefined,
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit User: ${user.name}`}
      description="Update assigned roles, department scope, and account credentials."
      wide
    >
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <label className="field">
            <span>Full Name *</span>
            <input required value={name} onChange={(e) => setName(e.target.value)} />
          </label>

          <label className="field">
            <span>Email Address</span>
            <input disabled value={user.email} className="opacity-60 cursor-not-allowed" />
          </label>

          <label className="field">
            <span>Reset Password (Optional)</span>
            <input
              type="password"
              placeholder="Leave blank to keep unchanged"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>

          <label className="field">
            <span>Primary Role *</span>
            <select
              value={primaryRole}
              onChange={(e) => {
                setPrimaryRole(e.target.value);
                if (!selectedRoles.includes(e.target.value)) {
                  setSelectedRoles((prev) => [...prev, e.target.value]);
                }
              }}
            >
              {roles.map((r) => (
                <option key={r.id} value={r.code}>
                  {r.name} ({r.code})
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Assigned Factory</span>
            <select value={factoryId} onChange={(e) => setFactoryId(e.target.value)}>
              <option value="">All / Global Facility</option>
              {factories.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} ({f.code})
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Assigned Department</span>
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">All / General</option>
              {departments
                .filter((d) => !factoryId || d.factoryId === factoryId)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.code})
                  </option>
                ))}
            </select>
          </label>
        </div>

        <div className="mt-4">
          <span className="text-xs font-semibold uppercase text-stone-600">
            Assigned Roles
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2 p-3 border rounded bg-stone-50 border-stone-200">
            {roles.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedRoles.includes(r.code)}
                  onChange={() => toggleRoleSelection(r.code)}
                />
                <span>{r.name}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="dialog-footer mt-5">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={update.isPending}>
            {update.isPending ? <Spinner /> : <Edit2 size={15} />}
            Save changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}
