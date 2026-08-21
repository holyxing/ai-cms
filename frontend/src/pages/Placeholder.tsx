/**
 * @deprecated P2.9 D1 - 路由已重定向到 /
 * 新位置: ContentLayout (左树状导航) + 栏目内容页 /c/:id
 * 此文件保留作为备份, 不再 import
 */
/**
 * 占位页 (用于 /contents /taxonomies /media 等顶层入口)
 *
 * 实际内容管理在 /sites/:id/contents, 栏目在 /sites/:id/taxonomies, 媒体在 /sites/:id/media
 * 用户从侧边栏顶层点进来会看到"先去站点选"
 */
import { Link } from 'react-router-dom';
import { Construction, ArrowRight } from 'lucide-react';
import { Button, Card, EmptyState } from '@/components/ui';
import { useQuery } from '@tanstack/react-query';
import { sitesApi } from '@/api/sites';
import { useAuthStore } from '@/stores/auth';

const PATH_HINT: Record<string, { real: string; pick: string }> = {
  内容管理: { real: '/sites/:id/contents', pick: '站点 → 内容' },
  栏目管理: { real: '/sites/:id/taxonomies', pick: '站点 → 栏目' },
  媒体库: { real: '/sites/:id/media', pick: '站点 → 媒体' },
  成员管理: { real: '/sites/:id/members', pick: '站点 → 成员' },
  站点设置: { real: '/sites/:id', pick: '站点 → 设置' },
};

export function PlaceholderPage({ title }: { title: string }) {
  const { user } = useAuthStore();
  const isSuper = user?.is_super_admin;
  const hint = PATH_HINT[title];

  // 所有登录用户都拉站点列表 (后端已按权限过滤: super 看全部, 其他只看自己成员站)
  const { data: sites } = useQuery({
    queryKey: ['sites-list-hint'],
    queryFn: () => sitesApi.list({ page_size: 20 }),
  });

  if (hint && sites?.items?.length) {
    const target = sites.items[0];
    const realPath = hint.real.replace(':id', target.id);
    return (
      <div className="space-y-4 p-6">
        <div>
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            该模块需要先选一个站点 ({sites.items.length} 个可选)
          </p>
        </div>
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">
              {isSuper ? '所有站点' : '你所在的站点'}
            </p>
            <p className="text-[10px] text-muted-foreground">
              按名称排序
            </p>
          </div>
          <ul className="max-h-[500px] space-y-1 overflow-y-auto">
            {sites.items.map((s) => (
              <li key={s.id}>
                <Link
                  to={hint.real.replace(':id', s.id)}
                  className="flex items-center justify-between rounded-md border border-transparent px-3 py-2 text-sm hover:border-border hover:bg-secondary/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{s.name}</div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      /{s.slug}
                    </div>
                  </div>
                  {s.id === target.id ? (
                    <Button
                      size="sm"
                      variant="default"
                      className="ml-2 h-7 px-3 text-xs"
                      onClick={(e) => {
                        e.preventDefault();
                        window.location.href = realPath;
                      }}
                    >
                      进入 <ArrowRight className="ml-1 h-3 w-3" />
                    </Button>
                  ) : (
                    <span className="ml-2 text-[10px] text-muted-foreground">→</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    );
  }

  if (hint && sites && !sites.items.length) {
    // 列表拉到了, 但用户没站
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center p-8 text-center">
        <Construction className="mb-4 h-12 w-12 text-muted-foreground/50" />
        <h2 className="mb-2 text-2xl font-semibold">{title}</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          {isSuper ? '请先创建一个站点' : '你还未加入任何站点, 请联系管理员'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-8 text-center">
      <Construction className="mb-4 h-12 w-12 text-muted-foreground/50" />
      <h2 className="mb-2 text-2xl font-semibold">{title}</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        该模块将在后续阶段开放
      </p>
    </div>
  );
}
