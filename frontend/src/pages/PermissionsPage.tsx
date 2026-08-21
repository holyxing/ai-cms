// PermissionsPage.tsx - 权限管理 (只读, super_admin)
import { useQuery } from '@tanstack/react-query';
import { KeyRound, Check, X } from 'lucide-react';
import { Card, CardContent, Badge, QueryLoading, QueryError, EmptyState } from '@/components/ui';
import { rbacApi, type PermissionGroup } from '@/api/rbac';
import { cn } from '@/lib/utils';

export function PermissionsPage() {
  const permsQ = useQuery({
    queryKey: ['rbac-permissions'],
    queryFn: () => rbacApi.listPermissionsGrouped(),
  });

  const rolesQ = useQuery({
    queryKey: ['rbac-roles'],
    queryFn: () => rbacApi.listRoles(),
  });

  const groups: PermissionGroup[] = permsQ.data ?? [];
  const roles = rolesQ.data ?? [];

  // 收集每个 permission code 被哪些角色使用
  const roleByPerm = (code: string): string[] =>
    roles.filter((r) => r.code === 'super_admin').length > 0
      ? roles.map((r) => r.code)  // super_admin 有全部, 简化
      : [];

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4">
        <h1 className="text-lg font-semibold tracking-tight">权限管理</h1>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          平台所有细粒度权限 ({groups.reduce((s, g) => s + g.permissions.length, 0)} 条, {groups.length} 个分类)。
          权限只读, 不可创建/删除。如需调整, 请修改角色绑定的权限。
        </p>
      </div>

      <div className="space-y-3">
        {permsQ.isLoading && (
          <div className="p-4"><QueryLoading variant="rows" count={4} /></div>
        )}
        {permsQ.isError && (
          <QueryError error={permsQ.error} onRetry={() => permsQ.refetch()} context="加载权限列表" />
        )}
        {!permsQ.isLoading && !permsQ.isError && groups.length === 0 && (
          <EmptyState
            icon={KeyRound as any}
            title="还没有权限定义"
            description="请检查数据库迁移状态, 权限数据由 RBAC 模块自动创建"
          />
        )}
        {groups.map((g) => (
          <Card key={g.resource}>
            <CardContent className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded bg-blue-50 text-blue-600">
                  <KeyRound className="h-3.5 w-3.5" />
                </div>
                <h2 className="text-[13px] font-semibold">{g.label}</h2>
                <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {g.resource}
                </code>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {g.permissions.length} 条
                </span>
              </div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {g.permissions.map((p) => (
                  <div
                    key={p.code}
                    className="flex items-start gap-2 rounded border bg-secondary/20 p-2"
                  >
                    <code className="flex-shrink-0 rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                      {p.code}
                    </code>
                    <span className="flex-1 text-[11px] text-muted-foreground">
                      {p.description}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
