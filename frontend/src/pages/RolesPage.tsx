// RolesPage.tsx - 角色管理 (super_admin)
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Copy, Users, Shield, X, Check } from 'lucide-react';
import { toast } from 'sonner';
import {
  Card, CardContent, Button, Input, Badge, Modal, ConfirmDialog, Textarea, QueryLoading, QueryError, EmptyState,
} from '@/components/ui';
import { rbacApi, type Role, type RoleDetail, type PermissionGroup } from '@/api/rbac';
import { cn } from '@/lib/utils';

export function RolesPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<RoleDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Role | null>(null);
  const [confirmClone, setConfirmClone] = useState<Role | null>(null);

  const rolesQ = useQuery({
    queryKey: ['rbac-roles'],
    queryFn: () => rbacApi.listRoles(),
  });
  const permsQ = useQuery({
    queryKey: ['rbac-permissions'],
    queryFn: () => rbacApi.listPermissionsGrouped(),
  });

  const roles = rolesQ.data ?? [];
  const perms = permsQ.data ?? [];

  const deleteMut = useMutation({
    mutationFn: (id: string) => rbacApi.deleteRole(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rbac-roles'] });
      toast('已删除角色');
      setConfirmDelete(null);
    },
    onError: (e: any) => toast.error(e?.message || '删除失败'),
  });

  const cloneMut = useMutation({
    mutationFn: (id: string) => rbacApi.cloneRole(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rbac-roles'] });
      toast('已复制角色');
      setConfirmClone(null);
    },
    onError: (e: any) => toast.error(e?.message || '复制失败'),
  });

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">角色管理</h1>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            管理系统内置角色 (super_admin/owner/editor/viewer) 或创建自定义角色。
            系统角色不可删除, 权限不可改。
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-3.5 w-3.5" />
          新建角色
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rolesQ.isLoading && (
          <div className="col-span-full">
            <QueryLoading variant="cards" count={6} />
          </div>
        )}
        {rolesQ.isError && (
          <div className="col-span-full">
            <QueryError error={rolesQ.error} onRetry={() => rolesQ.refetch()} context="加载角色列表" />
          </div>
        )}
        {!rolesQ.isLoading && !rolesQ.isError && roles.length === 0 && (
          <div className="col-span-full">
            <EmptyState
              icon={Shield as any}
              title="还没有自定义角色"
              description="点击右上角「新建角色」创建不同权限组合的角色"
              action={
                <Button onClick={() => setCreating(true)} size="sm">
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  新建角色
                </Button>
              }
            />
          </div>
        )}
        {roles.map((r) => (
          <Card key={r.id} className={cn('transition-shadow hover:shadow-md', r.is_system && 'border-blue-200/60')}>
            <CardContent className="flex flex-col gap-2 p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-md',
                    r.code === 'super_admin' ? 'bg-purple-100 text-purple-700' :
                    r.code === 'site_owner' ? 'bg-blue-100 text-blue-700' :
                    r.code === 'site_editor' ? 'bg-emerald-100 text-emerald-700' :
                    'bg-secondary text-muted-foreground',
                  )}>
                    <Shield className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold">{r.name}</div>
                    <code className="font-mono text-[10px] text-muted-foreground">{r.code}</code>
                  </div>
                </div>
                {r.is_system && <Badge variant="info" className="text-[9px]">系统</Badge>}
              </div>
              {r.description && (
                <p className="text-[11px] text-muted-foreground">{r.description}</p>
              )}
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span className="tabular-nums">
                  <span className="font-semibold text-foreground">{r.permission_count}</span> 权限
                </span>
                <span>·</span>
                <span className="tabular-nums">
                  <span className="font-semibold text-foreground">{r.user_count}</span> 用户
                </span>
              </div>
              <div className="mt-2 flex items-center gap-1">
                <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={async () => {
                  const detail = await rbacApi.getRole(r.id);
                  setEditing(detail);
                }}>
                  <Pencil className="h-3 w-3" />
                  {r.is_system ? '查看' : '编辑'}
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => setConfirmClone(r)}>
                  <Copy className="h-3 w-3" />
                  复制
                </Button>
                {!r.is_system && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px] text-destructive"
                    onClick={() => setConfirmDelete(r)}
                    disabled={r.user_count > 0}
                    title={r.user_count > 0 ? '该角色下还有用户, 不能删除' : ''}
                  >
                    <Trash2 className="h-3 w-3" />
                    删除
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {creating && (
        <RoleEditDialog
          perms={perms}
          onClose={() => setCreating(false)}
        />
      )}
      {editing && (
        <RoleEditDialog
          role={editing}
          perms={perms}
          onClose={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && deleteMut.mutate(confirmDelete.id)}
        title="删除角色"
        description={confirmDelete ? `确认删除角色 "${confirmDelete.name}"?` : ''}
        confirmText="删除"
        variant="danger"
        loading={deleteMut.isPending}
      />
      <ConfirmDialog
        open={!!confirmClone}
        onClose={() => setConfirmClone(null)}
        onConfirm={() => confirmClone && cloneMut.mutate(confirmClone.id)}
        title="复制角色"
        description={confirmClone ? `复制 "${confirmClone.name}" 为新的自定义角色?` : ''}
        confirmText="复制"
        variant="info"
        loading={cloneMut.isPending}
      />
    </div>
  );
}

// === 编辑/创建角色 dialog ===
function RoleEditDialog({
  role,
  perms,
  onClose,
}: {
  role?: RoleDetail;
  perms: PermissionGroup[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!role;
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [permissionCodes, setPermissionCodes] = useState<Set<string>>(
    new Set(role?.permission_codes ?? [])
  );
  const [code, setCode] = useState('');

  const saveMut = useMutation({
    mutationFn: () => isEdit
      ? rbacApi.updateRole(role!.id, {
          name,
          description,
          // 系统角色: 不能改权限
          ...(role!.is_system ? {} : { permission_codes: Array.from(permissionCodes) }),
        })
      : rbacApi.createRole({
          code,
          name,
          description,
          permission_codes: Array.from(permissionCodes),
        }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rbac-roles'] });
      qc.invalidateQueries({ queryKey: ['rbac-permissions'] });
      toast(isEdit ? '已保存' : '已创建');
      onClose();
    },
    onError: (e: any) => toast.error(e?.message || '保存失败'),
  });

  const toggle = (c: string) => {
    setPermissionCodes((s) => {
      const ns = new Set(s);
      if (ns.has(c)) ns.delete(c); else ns.add(c);
      return ns;
    });
  };

  const toggleGroup = (g: PermissionGroup) => {
    const allSelected = g.permissions.every((p) => permissionCodes.has(p.code));
    setPermissionCodes((s) => {
      const ns = new Set(s);
      if (allSelected) {
        g.permissions.forEach((p) => ns.delete(p.code));
      } else {
        g.permissions.forEach((p) => ns.add(p.code));
      }
      return ns;
    });
  };

  const isSystemReadonly = isEdit && role!.is_system;

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `角色: ${role!.name}` : '新建角色'}
      maxWidth="max-w-3xl"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-foreground">代码 (小写字母+下划线, 不可改)</label>
            {isEdit ? (
              <Input value={role!.code} disabled className="h-8 bg-secondary/30 text-[12px] font-mono" />
            ) : (
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="custom_role"
                className="h-8 text-[12px] font-mono"
                pattern="[a-z][a-z0-9_]*"
              />
            )}
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-foreground">显示名称</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isSystemReadonly}
              className="h-8 text-[12px]"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-foreground">描述</label>
          <Textarea
            value={description ?? ''}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isSystemReadonly}
            placeholder="角色的作用范围、适用场景..."
            className="min-h-16 text-[12px]"
          />
        </div>

        {/* 权限矩阵 */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-[11px] font-medium text-foreground">
              权限 ({permissionCodes.size} / {perms.reduce((s, g) => s + g.permissions.length, 0)})
              {isSystemReadonly && <span className="ml-2 text-[10px] text-amber-600">(系统角色只读)</span>}
            </label>
          </div>
          <div className="max-h-80 space-y-2 overflow-y-auto rounded-md border bg-secondary/20 p-2">
            {perms.map((g) => {
              const allSelected = g.permissions.every((p) => permissionCodes.has(p.code));
              const someSelected = g.permissions.some((p) => permissionCodes.has(p.code));
              return (
                <div key={g.resource} className="rounded border bg-card p-2">
                  <div className="mb-1 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => !isSystemReadonly && toggleGroup(g)}
                      disabled={isSystemReadonly}
                      className={cn(
                        'flex h-4 w-4 items-center justify-center rounded border',
                        allSelected ? 'border-blue-600 bg-blue-600 text-white' :
                        someSelected ? 'border-blue-600 bg-blue-100' :
                        'border-border bg-background',
                        isSystemReadonly && 'cursor-not-allowed opacity-60',
                      )}
                    >
                      {allSelected && <Check className="h-3 w-3" strokeWidth={3} />}
                      {!allSelected && someSelected && <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />}
                    </button>
                    <span className="text-[12px] font-semibold text-foreground">{g.label}</span>
                    <code className="font-mono text-[9px] text-muted-foreground">{g.resource}</code>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {g.permissions.filter((p) => permissionCodes.has(p.code)).length} / {g.permissions.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-1 pl-6 sm:grid-cols-2">
                    {g.permissions.map((p) => (
                      <label
                        key={p.code}
                        className={cn(
                          'flex cursor-pointer items-start gap-1.5 rounded px-1.5 py-1 text-[11px] transition-colors hover:bg-secondary/40',
                          permissionCodes.has(p.code) && 'text-blue-700',
                          isSystemReadonly && 'cursor-not-allowed opacity-60',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={permissionCodes.has(p.code)}
                          onChange={() => !isSystemReadonly && toggle(p.code)}
                          disabled={isSystemReadonly}
                          className="mt-0.5 h-3 w-3 rounded border-gray-300"
                        />
                        <span className="flex-1">
                          <code className="font-mono text-[10px]">{p.code}</code>
                          {p.description && (
                            <span className="ml-1 text-[10px] text-muted-foreground">- {p.description}</span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>取消</Button>
          <Button size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
            {saveMut.isPending ? '保存中...' : (isEdit ? '保存' : '创建')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
