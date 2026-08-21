/**
 * @deprecated P2.9 D1 - 路由已重定向到 /
 * 新位置: ContentLayout (左树状导航) + 栏目内容页 /c/:id
 * 此文件保留作为备份, 不再 import
 */
import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Users as UsersIcon,
  Plus,
  Trash2,
  Copy,
  Check,
  X as XIcon,
  Mail,
  Clock,
  UserMinus,
} from 'lucide-react';

import { sitesApi } from '@/api/sites';
import { membersApi, type Member, type Invitation, type SiteRole } from '@/api/members';
import { useAuthStore } from '@/stores/auth';
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Label, Badge, EmptyState, Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';

const ROLE_LABEL: Record<SiteRole, string> = {
  owner: '所有者',
  editor: '编辑',
  viewer: '查看者',
};
const ROLE_VARIANT: Record<SiteRole, 'default' | 'secondary' | 'muted'> = {
  owner: 'default',
  editor: 'secondary',
  viewer: 'muted',
};

// === 邀请对话框 ===
function InviteDialog({
  open,
  onClose,
  onInvited,
}: {
  open: boolean;
  onClose: () => void;
  onInvited: (token: string, email: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<SiteRole>('viewer');
  const [error, setError] = useState('');

  const inviteMut = useMutation({
    mutationFn: () => membersApi.createInvitation('', email.trim(), role),
    onSuccess: (data) => {
      onInvited(data.token, data.email);
      setEmail('');
      setRole('viewer');
      setError('');
    },
    onError: (e: any) => setError(e.message || '邀请失败'),
  });

  if (!open) return null;

  const isValidEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border bg-background shadow-lg">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold">邀请新成员</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">发送链接, 对方登录后即可加入</p>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <XIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isValidEmail) inviteMut.mutate();
          }}
          className="space-y-3 p-5"
        >
          <div className="space-y-1.5">
            <Label htmlFor="invite-email" className="text-xs font-medium">邮箱 *</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alice@example.com"
              required
              autoFocus
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">角色</Label>
            <div className="flex rounded-md border bg-background p-0.5">
              {(['viewer', 'editor', 'owner'] as SiteRole[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={cn(
                    'h-7 flex-1 rounded text-[11px] font-medium transition-colors',
                    role === r
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {ROLE_LABEL[r]}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {role === 'viewer' && '只能查看站点与内容'}
              {role === 'editor' && '可创建/编辑内容, 不能管理成员'}
              {role === 'owner' && '完整权限, 包括管理成员与站点设置'}
            </p>
          </div>
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} className="h-8 text-xs">取消</Button>
            <Button
              type="submit"
              disabled={!isValidEmail || inviteMut.isPending}
              className="h-8 text-xs"
            >
              {inviteMut.isPending ? '发送中...' : '发送邀请'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// === 邀请链接展示 ===
function InviteLinkDisplay({
  url,
  email,
  onClose,
}: {
  url: string;
  email: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border bg-background shadow-lg">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold">邀请已创建</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              发给 <span className="font-medium text-foreground">{email}</span>
            </p>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <XIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="space-y-3 p-5">
          <p className="text-xs text-muted-foreground">
            复制下面的链接发给 {email}, 对方登录后点击即可加入站点:
          </p>
          <div className="flex items-center gap-1.5">
            <Input value={url} readOnly className="h-8 text-[11px] font-mono" />
            <Button
              size="sm"
              variant="outline"
              className="h-8 flex-shrink-0"
              onClick={() => {
                navigator.clipboard.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50/50 p-2.5 text-[11px] text-amber-900">
            <Clock className="mr-1 inline h-3 w-3" />
            链接 7 天后过期, 只能使用一次
          </div>
          <div className="flex justify-end pt-1">
            <Button onClick={onClose} className="h-8 text-xs">完成</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// === 成员行 ===
function MemberRow({
  member,
  canManage,
  isMe,
  onRoleChange,
  onRemove,
}: {
  member: Member;
  canManage: boolean;
  isMe: boolean;
  onRoleChange: (memberId: string, role: SiteRole) => void;
  onRemove: (memberId: string, email: string) => void;
}) {
  return (
    <li className="flex items-center justify-between px-4 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground text-xs font-medium">
          {(member.user_name || member.user_email)[0].toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">
              {member.user_name || member.user_email}
            </span>
            {isMe && <Badge variant="muted" className="text-[10px]">我</Badge>}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{member.user_email}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {canManage ? (
          <select
            value={member.name}
            onChange={(e) => onRoleChange(member.id, e.target.value as SiteRole)}
            className="h-7 rounded-md border bg-background px-2 text-[11px] font-medium focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="viewer">查看者</option>
            <option value="editor">编辑</option>
            <option value="owner">所有者</option>
          </select>
        ) : (
          <Badge variant={ROLE_VARIANT[member.name]} className="text-[10px]">
            {ROLE_LABEL[member.name]}
          </Badge>
        )}
        {canManage && !isMe && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-red-600"
            onClick={() => onRemove(member.id, member.user_email)}
            title="移除"
          >
            <UserMinus className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </li>
  );
}

// === 邀请行 ===
function InvitationRow({
  inv,
  canManage,
  onRevoke,
}: {
  inv: Invitation;
  canManage: boolean;
  onRevoke: (id: string, email: string) => void;
}) {
  const status = inv.status || 'pending';
  return (
    <li className="flex items-center justify-between px-4 py-3 opacity-80">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <Mail className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{inv.email}</span>
            {status === 'pending' && <Badge variant="warning" className="text-[10px]">待接受</Badge>}
            {status === 'accepted' && <Badge variant="success" className="text-[10px]">已接受</Badge>}
            {status === 'expired' && <Badge variant="muted" className="text-[10px]">已过期</Badge>}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            邀请为 {ROLE_LABEL[inv.name]} ·{' '}
            {new Date(inv.created_at).toLocaleDateString('zh-CN')}
            {status === 'pending' && ` · ${new Date(inv.expires_at).toLocaleDateString('zh-CN')} 前有效`}
          </div>
        </div>
      </div>
      {canManage && status === 'pending' && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-red-600"
          onClick={() => onRevoke(inv.id, inv.email)}
          title="撤销"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </li>
  );
}

// === Members 页面 ===
export function MembersPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteLink, setInviteLink] = useState<{ url: string; email: string } | null>(null);

  const { data: site, isLoading: siteLoading } = useQuery({
    queryKey: ['site', id],
    queryFn: () => sitesApi.get(id!),
    enabled: !!id,
  });

  const { data: members, isLoading: memLoading } = useQuery({
    queryKey: ['members', id],
    queryFn: () => membersApi.listMembers(id!),
    enabled: !!id,
  });

  const { data: invitations } = useQuery({
    queryKey: ['invitations', id],
    queryFn: () => membersApi.listInvitations(id!),
    enabled: !!id,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['members', id] });
    queryClient.invalidateQueries({ queryKey: ['invitations', id] });
  };

  const updateRoleMut = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: SiteRole }) =>
      membersApi.updateMemberRole(id!, memberId, role),
    onSuccess: refresh,
  });

  const removeMut = useMutation({
    mutationFn: (memberId: string) => membersApi.removeMember(id!, memberId),
    onSuccess: refresh,
  });

  const revokeMut = useMutation({
    mutationFn: (invId: string) => membersApi.revokeInvitation(id!, invId),
    onSuccess: refresh,
  });

  if (siteLoading) {
    return (
      <div className="px-6 py-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!site) {
    return (
      <div className="px-6 py-6">
        <p className="text-sm text-muted-foreground">站点不存在</p>
        <Button variant="link" onClick={() => navigate('/sites')}>返回</Button>
      </div>
    );
  }

  const isOwner = !!currentUser && (currentUser.is_super_admin || currentUser.id === site.owner_id);
  const canManage = isOwner; // 简化: 仅 owner 可管理成员

  return (
    <div className="px-6 py-6 lg:px-8 lg:py-8 max-w-4xl">
      {/* 头部 */}
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(`/sites/${id}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600">
            <UsersIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight">成员</h1>
            <p className="text-[11px] text-muted-foreground">
              <Link to={`/sites/${id}`} className="hover:underline">{site.name}</Link>
              <span className="mx-1.5">·</span>
              共 {members?.length || 0} 人
            </p>
          </div>
        </div>
        <div className="ml-auto">
          {canManage && (
            <Button onClick={() => setInviteOpen(true)} className="h-8 text-xs">
              <Plus className="h-3.5 w-3.5" />
              邀请
            </Button>
          )}
        </div>
      </div>

      {/* 成员列表 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">成员 ({members?.length || 0})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {memLoading ? (
            <div className="p-5"><Skeleton className="h-12 w-full" /></div>
          ) : (members?.length || 0) === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={UsersIcon}
                title="还没有成员"
                description="只有站点创建者自动加入, 其他成员需要邀请"
              />
            </div>
          ) : (
            <ul className="divide-y">
              {members?.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  canManage={canManage}
                  isMe={m.user_id === currentUser?.id}
                  onRoleChange={(memberId, role) => updateRoleMut.mutate({ memberId, role })}
                  onRemove={(memberId, email) => {
                    if (confirm(`移除 ${email} ?`)) removeMut.mutate(memberId);
                  }}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* 邀请列表 */}
      {invitations && invitations.length > 0 && (
        <div className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">邀请 ({invitations.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y">
                {invitations.map((inv) => (
                  <InvitationRow
                    key={inv.id}
                    inv={inv}
                    canManage={canManage}
                    onRevoke={(invId, email) => {
                      if (confirm(`撤销 ${email} 的邀请?`)) revokeMut.mutate(invId);
                    }}
                  />
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}

      <InviteDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvited={(token, email) => {
          setInviteOpen(false);
          setInviteLink({
            url: `${window.location.origin}/invitations/accept?token=${token}`,
            email,
          });
        }}
      />
      {inviteLink && (
        <InviteLinkDisplay
          url={inviteLink.url}
          email={inviteLink.email}
          onClose={() => setInviteLink(null)}
        />
      )}
    </div>
  );
}
