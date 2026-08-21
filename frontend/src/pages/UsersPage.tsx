// UsersPage.tsx - 用户管理 (super_admin)
// 依据: docs/10-权限矩阵.md §2.10
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Pencil, ShieldOff, ShieldCheck, Trash2, FolderTree, X as XIcon, Check, Users } from 'lucide-react';
import { toast } from 'sonner';
import {
  Card, CardContent, Button, Input, Badge, Avatar, ConfirmDialog, Modal, QueryLoading, QueryError, EmptyState, FilterChips,
} from '@/components/ui';
import { useAuthStore } from '@/stores/auth';
import { rbacApi, type UserListItem, type Role, type SiteMember, type SiteAssignment } from '@/api/rbac';
import { sitesApi, type SiteListItem } from '@/api/sites';
import { cn } from '@/lib/utils';

export function UsersPage() {
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<UserListItem | null>(null);
  const [assigning, setAssigning] = useState<UserListItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<UserListItem | null>(null);
  const [confirmToggle, setConfirmToggle] = useState<UserListItem | null>(null);

  // === 数据 ===
  const usersQ = useQuery({
    queryKey: ['rbac-users', search, statusFilter],
    queryFn: () => rbacApi.listUsers({
      q: search || undefined,
      is_active: statusFilter === 'active' ? true : statusFilter === 'inactive' ? false : undefined,
      page_size: 200,
    }),
  });
  const rolesQ = useQuery({
    queryKey: ['rbac-roles'],
    queryFn: () => rbacApi.listRoles(),
  });

  const users = usersQ.data ?? [];
  const roles = rolesQ.data ?? [];

  // === Mutations ===
  const deleteMut = useMutation({
    mutationFn: (id: string) => rbacApi.deleteUser(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rbac-users'] });
      toast('已停用用户');
      setConfirmDelete(null);
    },
    onError: (e: any) => toast.error(e?.message || '停用失败'),
  });
  const toggleMut = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      rbacApi.updateUser(id, { is_active }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['rbac-users'] });
      toast(v.is_active ? '已启用' : '已停用');
      setConfirmToggle(null);
    },
    onError: (e: any) => toast.error(e?.message || '操作失败'),
  });

  return (
    <div className="mx-auto max-w-6xl p-6">
      {/* Header */}
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">用户管理</h1>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            管理平台用户、分配全局角色、绑定可访问的站点。仅超级管理员可见。
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          新建用户
        </Button>
      </div>

      {/* Filters */}
      <div className="mb-3 flex items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索邮箱/姓名..."
            className="h-8 pl-8 text-[12px]"
          />
        </div>
        <FilterChips<'all' | 'active' | 'inactive'>
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'all', label: '全部' },
            { value: 'active', label: '已启用' },
            { value: 'inactive', label: '已停用' },
          ]}
        />
        <div className="ml-auto text-[11px] text-muted-foreground">
          共 {users.length} 个用户
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-[12px]">
            <thead className="border-b bg-secondary/30 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2">用户</th>
                <th className="px-3 py-2">状态</th>
                <th className="px-3 py-2">全局角色</th>
                <th className="px-3 py-2">可访问站点</th>
                <th className="px-3 py-2">最近登录</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {usersQ.isLoading && (
                <tr>
                  <td colSpan={6} className="px-4 py-12">
                    <QueryLoading variant="rows" count={3} />
                  </td>
                </tr>
              )}
              {usersQ.isError && (
                <tr>
                  <td colSpan={6}>
                    <QueryError error={usersQ.error} onRetry={() => usersQ.refetch()} context="加载用户列表" />
                  </td>
                </tr>
              )}
              {!usersQ.isLoading && users.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-0">
                    <EmptyState
                      icon={Users as any}
                      title={search ? `没有匹配 "${search}" 的用户` : '还没有用户'}
                      description="点击右上角「新建用户」邀请成员加入"
                      size="sm"
                      className="rounded-none border-0"
                    />
                  </td>
                </tr>
              )}
              {users.map((u) => (
                <tr key={u.id} className="border-b transition-colors last:border-0 hover:bg-secondary/20">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={u.name} size="sm" />
                      <div>
                        <div className="font-medium text-foreground">{u.name}</div>
                        <div className="text-[10px] text-muted-foreground">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    {u.is_active ? (
                      <Badge variant="success" className="text-[10px]">启用</Badge>
                    ) : (
                      <Badge variant="muted" className="text-[10px]">停用</Badge>
                    )}
                    {u.is_super_admin && (
                      <Badge variant="info" className="ml-1 text-[10px]">Super</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {u.role_codes.length === 0 ? (
                      <span className="text-muted-foreground/60">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {u.role_codes.map((rc) => (
                          <Badge key={rc} variant="muted" className="text-[10px]">{rc}</Badge>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="tabular-nums">{u.site_count}</span>
                    <span className="ml-1 text-[10px] text-muted-foreground">个</span>
                  </td>
                  <td className="px-3 py-2.5 text-[10px] text-muted-foreground">
                    {u.last_login_at
                      ? new Date(u.last_login_at).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })
                      : '从未登录'}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setEditing(u)}
                        title="编辑"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-blue-600"
                        onClick={() => setAssigning(u)}
                        title="分配可访问站点"
                      >
                        <FolderTree className="h-3.5 w-3.5" />
                      </Button>
                      {u.id !== currentUser?.id && (
                        u.is_active ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-amber-600"
                            onClick={() => setConfirmToggle(u)}
                            title="停用"
                          >
                            <ShieldOff className="h-3.5 w-3.5" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-emerald-600"
                            onClick={() => setConfirmToggle(u)}
                            title="启用"
                          >
                            <ShieldCheck className="h-3.5 w-3.5" />
                          </Button>
                        )
                      )}
                      {u.id !== currentUser?.id && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={() => setConfirmDelete(u)}
                          title="软删 (停用)"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Modals */}
      {createOpen && (
        <UserFormModal
          roles={roles}
          onClose={() => setCreateOpen(false)}
        />
      )}
      {editing && (
        <UserFormModal
          user={editing}
          roles={roles}
          onClose={() => setEditing(null)}
        />
      )}
      {assigning && (
        <AssignSitesModal
          user={assigning}
          onClose={() => setAssigning(null)}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && deleteMut.mutate(confirmDelete.id)}
        title="停用用户"
        description={confirmDelete ? `确认停用 "${confirmDelete.name}" (${confirmDelete.email})? 停用后该用户无法登录, 数据保留。` : ''}
        confirmText="停用"
        variant="danger"
        loading={deleteMut.isPending}
      />
      <ConfirmDialog
        open={!!confirmToggle}
        onClose={() => setConfirmToggle(null)}
        onConfirm={() =>
          confirmToggle && toggleMut.mutate({ id: confirmToggle.id, is_active: !confirmToggle.is_active })
        }
        title={confirmToggle?.is_active ? '停用用户' : '启用用户'}
        description={confirmToggle ? `确认${confirmToggle.is_active ? '停用' : '启用'} "${confirmToggle.name}"?` : ''}
        confirmText={confirmToggle?.is_active ? '停用' : '启用'}
        variant={confirmToggle?.is_active ? 'danger' : 'info'}
        loading={toggleMut.isPending}
      />
    </div>
  );
}

// === 创建/编辑用户 dialog ===
function UserFormModal({
  user,
  roles,
  onClose,
}: {
  user?: UserListItem;
  roles: Role[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!user;
  const [email, setEmail] = useState(user?.email ?? '');
  const [name, setName] = useState(user?.name ?? '');
  const [password, setPassword] = useState('');
  const [isActive, setIsActive] = useState(user?.is_active ?? true);
  const [roleCodes, setRoleCodes] = useState<string[]>(user?.role_codes ?? []);

  const saveMut = useMutation({
    mutationFn: () => isEdit
      ? rbacApi.updateUser(user!.id, {
          name,
          is_active: isActive,
          role_codes: roleCodes,
          ...(password ? { password } : {}),
        })
      : rbacApi.createUser({ email, name, password, is_active: isActive, role_codes: roleCodes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rbac-users'] });
      toast(isEdit ? '已保存' : '已创建');
      onClose();
    },
    onError: (e: any) => toast.error(e?.message || '保存失败'),
  });

  const toggleRole = (code: string) => {
    setRoleCodes((s) => s.includes(code) ? s.filter((c) => c !== code) : [...s, code]);
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? '编辑用户' : '新建用户'} maxWidth="max-w-md">
      
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!isEdit && (!email || !password)) {
              toast.error('邮箱和密码必填');
              return;
            }
            if (!isEdit && password.length < 8) {
              toast.error('密码至少 8 位');
              return;
            }
            saveMut.mutate();
          }}
          className="space-y-3"
        >
          <div>
            <label className="mb-1 block text-[11px] font-medium text-foreground">邮箱</label>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isEdit}
              placeholder="user@example.com"
              required
              className="h-8 text-[12px]"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-foreground">姓名</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="h-8 text-[12px]"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-foreground">
              {isEdit ? '重置密码 (留空不改)' : '密码'}
            </label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isEdit ? '不修改留空' : '至少 8 位'}
              className="h-8 text-[12px]"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is-active"
              checked={isActive}
              onChange={(e: any) => setIsActive(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-gray-300"
            />
            <label htmlFor="is-active" className="text-[12px]">启用账号</label>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-foreground">全局角色 (可多选)</label>
            <div className="grid grid-cols-1 gap-1.5 rounded-md border bg-secondary/20 p-2">
              {roles.map((r) => (
                <label
                  key={r.code}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[12px] transition-colors hover:bg-secondary/60',
                    roleCodes.includes(r.code) && 'bg-blue-50 text-blue-700',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={roleCodes.includes(r.code)}
                    onChange={() => toggleRole(r.code)}
                    disabled={r.code === 'super_admin' && user?.id === useAuthStore.getState().user?.id}
                    className="h-3.5 w-3.5 rounded border-gray-300"
                  />
                  <span className="flex-1">
                    <span className="font-medium">{r.name}</span>
                    <code className="ml-1.5 rounded bg-secondary px-1 py-0.5 font-mono text-[9px] text-muted-foreground">
                      {r.code}
                    </code>
                    {r.is_system && <Badge variant="muted" className="ml-1 text-[9px]">系统</Badge>}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" size="sm" disabled={saveMut.isPending}>
              {saveMut.isPending ? '保存中...' : (isEdit ? '保存' : '创建')}
            </Button>
          </div>
        </form>
    </Modal>
  );
}

// === 分配可访问站点 dialog ===
function AssignSitesModal({
  user,
  onClose,
}: {
  user: UserListItem;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const sitesQ = useQuery({
    queryKey: ['sites', 'active'] as const,
    queryFn: () => sitesApi.list({ page: 1, page_size: 200, status: 'active' }).catch(() => ({ items: [], total: 0, page: 1, page_size: 0 })),
  });
  const currentQ = useQuery({
    queryKey: ['rbac-user-sites', user.id],
    queryFn: () => rbacApi.getUserSites(user.id),
  });

  const [assignments, setAssignments] = useState<SiteAssignment[]>([]);
  const [loaded, setLoaded] = useState(false);

  // 初次加载时同步已有绑定
  if (!loaded && currentQ.data) {
    setAssignments(
      currentQ.data
        .filter((s) => s.name !== 'owner')  // owner 关系不通过这里管
        .map((s) => ({ site_id: s.site_id, name: s.name as any })),
    );
    setLoaded(true);
  }

  const saveMut = useMutation({
    mutationFn: () => rbacApi.assignUserSites(user.id, assignments),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rbac-user-sites', user.id] });
      qc.invalidateQueries({ queryKey: ['rbac-users'] });
      toast('已保存站点分配');
      onClose();
    },
    onError: (e: any) => toast.error(e?.message || '保存失败'),
  });

  const sites: SiteListItem[] = sitesQ.data?.items ?? [];
  const currentMap = new Map(assignments.map((a) => [a.site_id, a.name]));

  const setRole = (siteId: string, name: 'owner' | 'editor' | 'viewer' | null) => {
    setAssignments((s) => {
      if (name === null) {
        return s.filter((a) => a.site_id !== siteId);
      }
      if (currentMap.has(siteId)) {
        return s.map((a) => a.site_id === siteId ? { site_id: siteId, name } : a);
      }
      return [...s, { site_id: siteId, name }];
    });
  };

  return (
    <Modal open onClose={onClose} title="分配可访问站点" maxWidth="max-w-lg">
      <p className="text-[11px] text-muted-foreground">
          为 <span className="font-medium text-foreground">{user.name}</span> 设置每个站点的角色。
          未勾选的站点 = 不可访问。
        </p>
        <div className="max-h-96 space-y-1 overflow-y-auto rounded-md border bg-secondary/20 p-2">
          {sitesQ.isLoading && (
            <div className="p-2"><QueryLoading variant="rows" count={3} /></div>
          )}
          {sites.map((s) => {
            const role = currentMap.get(s.id) ?? null;
            return (
              <div
                key={s.id}
                className={cn(
                  'flex items-center gap-2 rounded px-2 py-1.5 text-[12px]',
                  role ? 'bg-blue-50' : 'hover:bg-secondary/40',
                )}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded bg-secondary text-[10px]">
                  {s.name.charAt(0)}
                </span>
                <div className="flex-1 truncate">
                  <div className="truncate font-medium">{s.name}</div>
                  <code className="font-mono text-[10px] text-muted-foreground">/{s.slug}</code>
                </div>
                <div className="flex items-center gap-1">
                  {(['owner', 'editor', 'viewer'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRole(s.id, role === r ? null : r)}
                      className={cn(
                        'h-6 rounded px-2 text-[10px] font-medium transition-colors',
                        role === r
                          ? r === 'owner' ? 'bg-purple-600 text-white'
                            : r === 'editor' ? 'bg-blue-600 text-white'
                            : 'bg-muted-foreground text-background'
                          : 'border bg-secondary text-muted-foreground hover:bg-secondary/70',
                      )}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>共分配 {assignments.length} 个站点</span>
          <span>站点 owner 由「站点 → 成员」管理, 不在此处改</span>
        </div>
        <div className="flex justify-end gap-2 pt-3">
          <Button variant="outline" size="sm" onClick={onClose}>取消</Button>
          <Button size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
            {saveMut.isPending ? '保存中...' : '保存'}
          </Button>
        </div>
    </Modal>
  );
}
