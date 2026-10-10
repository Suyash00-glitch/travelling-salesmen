import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus,
  Check,
  Edit2,
  Trash2,
} from 'lucide-react';
import {
  type RoleDetail,
  permissionResources,
  permissionActions,
  type PermissionResource,
} from '@loomos/shared';
import { useData } from '../../hooks/useFactory';
import { api } from '../../services/api';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/dialog';
import { Badge, Panel, Spinner } from '../../components/shared/common';
import { label } from '../../lib/utils';

export function RoleManagementTab() {
  const client = useQueryClient();
  const [createModal, setCreateModal] = useState(false);
  const [editRole, setEditRole] = useState<RoleDetail | null>(null);

  const rolesQuery = useData<RoleDetail[]>('/rbac/roles');

  const deleteRole = useMutation({
    mutationFn: (roleId: string) => api(`/rbac/roles/${roleId}`, undefined, 'DELETE'),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['/rbac/roles'] });
      toast.success('Custom role deleted.');
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const rolesList = rolesQuery.data ?? [];

  return (
    <>
      <Panel
        title="Role & Permission Templates"
        subtitle="Manage the 13 standard factory roles and configure granular action permissions (view, create, update, approve, manage)."
        action={
          <Button size="sm" onClick={() => setCreateModal(true)}>
            <Plus size={15} />
            Create custom role
          </Button>
        }
      >
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Role name</th>
                <th>Role code</th>
                <th>Type</th>
                <th>Assigned users</th>
                <th>Permissions count</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rolesList.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="cell-stack">
                      <strong>{r.name}</strong>
                      <span className="text-xs muted">{r.description || 'System role template'}</span>
                    </div>
                  </td>
                  <td>
                    <code className="text-xs px-1.5 py-0.5 rounded bg-stone-100 dark:bg-stone-800 font-mono">
                      {r.code}
                    </code>
                  </td>
                  <td>
                    <Badge value={r.isSystem ? 'READY' : 'NORMAL'}>
                      {r.isSystem ? 'System Role' : 'Custom Role'}
                    </Badge>
                  </td>
                  <td>
                    <span className="tabular font-medium">{r.userCount}</span>
                  </td>
                  <td>
                    <span className="tabular font-medium">{r.permissions.length} actions</span>
                  </td>
                  <td>
                    <div className="flex gap-2 items-center">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditRole(r)}
                        title="Configure permission matrix"
                      >
                        <Edit2 size={13} />
                        Permissions
                      </Button>

                      {!r.isSystem && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (window.confirm(`Delete custom role '${r.name}'?`)) {
                              deleteRole.mutate(r.id);
                            }
                          }}
                          disabled={deleteRole.isPending || r.userCount > 0}
                          title={
                            r.userCount > 0
                              ? 'Cannot delete role assigned to users'
                              : 'Delete custom role'
                          }
                        >
                          <Trash2 size={13} />
                          Delete
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* CREATE CUSTOM ROLE MODAL */}
      {createModal && <CreateRoleModal onClose={() => setCreateModal(false)} />}

      {/* EDIT ROLE PERMISSIONS MATRIX MODAL */}
      {editRole && (
        <EditPermissionsModal role={editRole} onClose={() => setEditRole(null)} />
      )}
    </>
  );
}

// ----------------- CREATE ROLE MODAL -----------------
function CreateRoleModal({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(
    new Set(['dashboard:view']),
  );

  const create = useMutation({
    mutationFn: (body: unknown) => api('/rbac/roles', body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['/rbac/roles'] });
      toast.success('Custom role created successfully.');
      onClose();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const togglePermission = (permCode: string) => {
    setSelectedPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(permCode)) next.delete(permCode);
      else next.add(permCode);
      return next;
    });
  };

  const toggleResourceAll = (resource: PermissionResource) => {
    const allForResource = permissionActions.map((a) => `${resource}:${a}`);
    const allSelected = allForResource.every((c) => selectedPermissions.has(c));

    setSelectedPermissions((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        allForResource.forEach((c) => next.delete(c));
      } else {
        allForResource.forEach((c) => next.add(c));
      }
      return next;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate({
      code: code.toUpperCase().trim(),
      name: name.trim(),
      description: description.trim(),
      permissions: Array.from(selectedPermissions),
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Create Custom Role"
      description="Define a new role code, title, and configure allowed resource actions."
      wide
    >
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <label className="field">
            <span>Role Code (UPPERCASE_SNAKE) *</span>
            <input
              required
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s+/g, '_'))}
              placeholder="e.g. FLOOR_TEAM_LEAD"
            />
          </label>

          <label className="field">
            <span>Display Name *</span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Floor Team Lead"
            />
          </label>

          <label className="field col-span-2">
            <span>Description</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Operational responsibilities and scope"
            />
          </label>
        </div>

        <div className="mt-5">
          <div className="flex justify-between items-center mb-2">
            <h4 className="text-xs font-semibold uppercase text-stone-600 dark:text-stone-400">
              Granular Permission Matrix
            </h4>
            <span className="text-xs text-stone-500">
              {selectedPermissions.size} permissions selected
            </span>
          </div>

          <div className="overflow-x-auto border rounded bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-800">
            <table className="w-full text-xs text-left">
              <thead className="bg-stone-50 dark:bg-stone-950 border-b border-stone-200 dark:border-stone-800 font-semibold text-stone-600 dark:text-stone-400">
                <tr>
                  <th className="p-2">Resource</th>
                  {permissionActions.map((action) => (
                    <th key={action} className="p-2 text-center uppercase text-[10px]">
                      {action}
                    </th>
                  ))}
                  <th className="p-2 text-right">Quick toggle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {permissionResources.map((resource) => (
                  <tr key={resource} className="hover:bg-stone-50 dark:hover:bg-stone-800/50">
                    <td className="p-2 font-medium capitalize">{label(resource)}</td>
                    {permissionActions.map((action) => {
                      const permCode = `${resource}:${action}`;
                      const isChecked = selectedPermissions.has(permCode);
                      return (
                        <td key={action} className="p-2 text-center">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => togglePermission(permCode)}
                            className="cursor-pointer"
                          />
                        </td>
                      );
                    })}
                    <td className="p-2 text-right">
                      <button
                        type="button"
                        onClick={() => toggleResourceAll(resource)}
                        className="text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline"
                      >
                        Toggle all
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="dialog-footer mt-5">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={create.isPending}>
            {create.isPending ? <Spinner /> : <Plus size={15} />}
            Create role
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ----------------- EDIT PERMISSIONS MATRIX MODAL -----------------
function EditPermissionsModal({
  role,
  onClose,
}: {
  role: RoleDetail;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description);
  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(
    new Set(role.permissions),
  );

  const update = useMutation({
    mutationFn: (body: unknown) => api(`/rbac/roles/${role.id}`, body, 'PUT'),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['/rbac/roles'] });
      void client.invalidateQueries({ queryKey: ['session'] });
      toast.success(`Permissions updated for role ${role.name}.`);
      onClose();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const togglePermission = (permCode: string) => {
    setSelectedPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(permCode)) next.delete(permCode);
      else next.add(permCode);
      return next;
    });
  };

  const toggleResourceAll = (resource: PermissionResource) => {
    const allForResource = permissionActions.map((a) => `${resource}:${a}`);
    const allSelected = allForResource.every((c) => selectedPermissions.has(c));

    setSelectedPermissions((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        allForResource.forEach((c) => next.delete(c));
      } else {
        allForResource.forEach((c) => next.add(c));
      }
      return next;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    update.mutate({
      name: role.isSystem ? undefined : name,
      description: description,
      permissions: Array.from(selectedPermissions),
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Permission Matrix: ${role.name}`}
      description={`Configure actions allowed for role '${role.code}'. Changes take effect immediately.`}
      wide
    >
      <form onSubmit={handleSubmit}>
        {!role.isSystem && (
          <div className="form-grid mb-4">
            <label className="field">
              <span>Role Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label className="field">
              <span>Description</span>
              <input value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
          </div>
        )}

        <div>
          <div className="flex justify-between items-center mb-2">
            <h4 className="text-xs font-semibold uppercase text-stone-600 dark:text-stone-400">
              Granular Resource Permissions
            </h4>
            <span className="text-xs text-stone-500 font-medium">
              {selectedPermissions.size} permissions granted
            </span>
          </div>

          <div className="overflow-x-auto border rounded bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-800 max-h-96">
            <table className="w-full text-xs text-left">
              <thead className="bg-stone-50 dark:bg-stone-950 sticky top-0 border-b border-stone-200 dark:border-stone-800 font-semibold text-stone-600 dark:text-stone-400">
                <tr>
                  <th className="p-2">Resource</th>
                  {permissionActions.map((action) => (
                    <th key={action} className="p-2 text-center uppercase text-[10px]">
                      {action}
                    </th>
                  ))}
                  <th className="p-2 text-right">Quick toggle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {permissionResources.map((resource) => (
                  <tr key={resource} className="hover:bg-stone-50 dark:hover:bg-stone-800/50">
                    <td className="p-2 font-medium capitalize">{label(resource)}</td>
                    {permissionActions.map((action) => {
                      const permCode = `${resource}:${action}`;
                      const isChecked = selectedPermissions.has(permCode);
                      return (
                        <td key={action} className="p-2 text-center">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => togglePermission(permCode)}
                            className="cursor-pointer"
                          />
                        </td>
                      );
                    })}
                    <td className="p-2 text-right">
                      <button
                        type="button"
                        onClick={() => toggleResourceAll(resource)}
                        className="text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline"
                      >
                        Toggle all
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="dialog-footer mt-5">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={update.isPending}>
            {update.isPending ? <Spinner /> : <Check size={15} />}
            Save permissions
          </Button>
        </div>
      </form>
    </Modal>
  );
}
