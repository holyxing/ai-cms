import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Mail, Check, X as XIcon, Loader2, AlertCircle } from 'lucide-react';

import { membersApi, type Invitation } from '@/api/members';
import { useAuthStore } from '@/stores/auth';
import { Card, CardContent, Button } from '@/components/ui';

type State = 'loading' | 'idle' | 'accepting' | 'accepted' | 'error';

export function AcceptInvitationPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.user);

  const token = searchParams.get('token') || '';
  const [state, setState] = useState<State>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  // 查我的待接受邀请列表 (获取站点信息展示)
  const { data: myInvitations } = useQuery({
    queryKey: ['my-invitations'],
    queryFn: () => membersApi.listMyInvitations(),
    enabled: !!currentUser,
  });

  const acceptMut = useMutation({
    mutationFn: () => membersApi.acceptInvitation(token),
    onSuccess: (data) => {
      setState('accepted');
      setTimeout(() => navigate(`/sites`), 2000);
    },
    onError: (e: any) => {
      setState('error');
      setErrorMsg(e.message || '接受失败');
    },
  });

  useEffect(() => {
    if (!token) {
      setState('error');
      setErrorMsg('邀请链接无效 (缺少 token)');
    } else {
      setState('idle');
    }
  }, [token]);

  const handleAccept = () => {
    setState('accepting');
    acceptMut.mutate();
  };

  // 找对应的邀请 (用于显示站点名)
  const matchedInv: Invitation | undefined = myInvitations?.find(
    (i: any) => i.token === token,
  );

  // 未登录
  if (!currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-secondary/30 p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="p-6 text-center space-y-3">
            <Mail className="mx-auto h-8 w-8 text-blue-500" />
            <h1 className="text-base font-semibold">邀请</h1>
            <p className="text-[11px] text-muted-foreground">
              请先登录后再接受邀请
            </p>
            <Button
              onClick={() => navigate(`/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`)}
              className="w-full h-9 text-sm"
            >
              前往登录
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-secondary/30 p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="p-6 space-y-4">
          {state === 'loading' && (
            <div className="flex justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {state === 'idle' && (
            <>
              <div className="text-center">
                <Mail className="mx-auto h-8 w-8 text-blue-500" />
                <h1 className="mt-2 text-base font-semibold">你收到一个邀请</h1>
                {matchedInv ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    邀请你加入 <span className="font-medium text-foreground">{(matchedInv as any).site_name || '站点'}</span> · 角色 {(matchedInv as any).role}
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    邀请链接有效, 登录账号 <span className="font-medium text-foreground">{currentUser.email}</span> 即可加入
                  </p>
                )}
              </div>
              <Button onClick={handleAccept} className="w-full h-9 text-sm">
                接受邀请
              </Button>
              <Button onClick={() => navigate('/dashboard')} variant="ghost" className="w-full h-8 text-xs">
                暂不接受
              </Button>
            </>
          )}

          {state === 'accepting' && (
            <div className="flex flex-col items-center gap-2 py-4">
              <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
              <p className="text-[11px] text-muted-foreground">正在加入...</p>
            </div>
          )}

          {state === 'accepted' && (
            <div className="text-center space-y-2">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-green-50">
                <Check className="h-5 w-5 text-green-600" />
              </div>
              <h1 className="text-base font-semibold">已加入</h1>
              <p className="text-[11px] text-muted-foreground">2 秒后跳转到站点列表...</p>
            </div>
          )}

          {state === 'error' && (
            <div className="text-center space-y-3">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-red-50">
                <AlertCircle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <h1 className="text-base font-semibold">无法接受邀请</h1>
                <p className="mt-1 text-[11px] text-muted-foreground">{errorMsg}</p>
              </div>
              <Button onClick={() => navigate('/dashboard')} className="w-full h-9 text-sm">
                返回工作台
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
