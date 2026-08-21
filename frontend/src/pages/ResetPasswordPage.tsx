// P5.2 重置密码页: 从邮件链接进来, 输入新密码
import { useState, useEffect, type FormEvent } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Lock, Eye, EyeOff, ArrowLeft, Loader2, AlertCircle, Sparkles, CheckCircle2 } from 'lucide-react';
import { authApi } from '@/api/auth';
import { Button, Input, Label, QueryLoading, QueryError } from '@/components/ui';
import { toast } from 'sonner';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';

  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  // 拉 token 状态 (验证 / 过期 / 已用)
  const tokenQ = useQuery({
    queryKey: ['password-reset-token-info', token],
    queryFn: () => authApi.passwordResetTokenInfo(token),
    enabled: !!token,
    retry: false,
  });

  useEffect(() => {
    if (tokenQ.data && !tokenQ.data.valid) {
      if (tokenQ.data.used) {
        toast.error('该重置链接已被使用');
      } else if (tokenQ.data.expired) {
        toast.error('重置链接已过期, 请重新申请');
      }
    }
  }, [tokenQ.data]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (pwd.length < 8) {
      toast.error('新密码至少 8 位');
      return;
    }
    if (pwd !== pwd2) {
      toast.error('两次输入的密码不一致');
      return;
    }
    setLoading(true);
    try {
      await authApi.resetPassword(token, pwd);
      setDone(true);
      toast.success('密码已重置');
    } catch (e: any) {
      toast.error(e?.message || '重置失败, 请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  // 没 token
  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="rounded-lg border bg-card p-6 max-w-md w-full text-center space-y-3">
          <AlertCircle className="h-8 w-8 text-amber-500 mx-auto" />
          <h1 className="text-base font-semibold">链接无效</h1>
          <p className="text-sm text-muted-foreground">
            请从邮件中的链接进入此页面, 或重新申请重置.
          </p>
          <Link to="/forgot-password">
            <Button size="sm">重新申请</Button>
          </Link>
        </div>
      </div>
    );
  }

  // 加载 token 状态
  if (tokenQ.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <QueryLoading variant="block" count={3} />
      </div>
    );
  }

  if (tokenQ.isError) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <QueryError error={tokenQ.error as any} onRetry={() => tokenQ.refetch()} />
          <div className="mt-4 text-center">
            <Link to="/forgot-password">
              <Button size="sm" variant="outline">重新申请</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // token 无效 (已用/过期/不存在)
  if (tokenQ.data && !tokenQ.data.valid) {
    const { used, expired, email_hint } = tokenQ.data;
    // 区分消息: used > expired > 不存在 (email_hint 是 null 就是不存在)
    const title = used
      ? '链接已被使用'
      : expired
        ? '链接已过期'
        : '链接无效';
    const desc = used
      ? '该重置链接已被使用过, 每次重置只能使用一次.'
      : expired
        ? '重置链接 1 小时内有效. 请重新申请.'
        : '链接不存在或格式错误. 请从邮件中的链接重新进入, 或重新申请.';
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="rounded-lg border bg-card p-6 max-w-md w-full text-center space-y-3">
          <AlertCircle className="h-8 w-8 text-amber-500 mx-auto" />
          <h1 className="text-base font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">{desc}</p>
          {email_hint && (
            <p className="text-xs text-muted-foreground">
              账户: <span className="font-mono">{email_hint}</span>
            </p>
          )}
          <Link to="/forgot-password">
            <Button size="sm">重新申请</Button>
          </Link>
        </div>
      </div>
    );
  }

  // 成功
  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="rounded-lg border bg-card p-6 max-w-md w-full text-center space-y-3">
          <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto" />
          <h1 className="text-base font-semibold">密码已重置</h1>
          <p className="text-sm text-muted-foreground">
            请使用新密码登录{tokenQ.data?.email_hint && (
              <> (邮箱: <span className="font-mono">{tokenQ.data.email_hint}</span>)</>
            )}
          </p>
          <Button size="sm" onClick={() => navigate('/login', { replace: true })}>
            去登录
          </Button>
        </div>
      </div>
    );
  }

  // 主表单
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-[420px]">
        <div className="text-center mb-6">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary mb-3">
            <Sparkles className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">设置新密码</h1>
          {tokenQ.data?.email_hint && (
            <p className="text-xs text-muted-foreground mt-1">
              账户: <span className="font-mono">{tokenQ.data.email_hint}</span>
            </p>
          )}
        </div>

        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pwd">新密码</Label>
              <div className="relative">
                <Lock className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  id="pwd"
                  type={showPwd ? 'text' : 'password'}
                  required
                  autoFocus
                  autoComplete="new-password"
                  value={pwd}
                  onChange={(e) => setPwd(e.target.value)}
                  placeholder="至少 8 位"
                  className="pl-8 pr-9"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPwd ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pwd2">确认密码</Label>
              <div className="relative">
                <Lock className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  id="pwd2"
                  type={showPwd ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  value={pwd2}
                  onChange={(e) => setPwd2(e.target.value)}
                  placeholder="再输入一次"
                  className="pl-8"
                  disabled={loading}
                />
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={loading || !pwd || !pwd2}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  重置中…
                </>
              ) : (
                '重置密码'
              )}
            </Button>

            <div className="text-center text-xs text-muted-foreground pt-2">
              <Link
                to="/login"
                className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-3 w-3" />
                返回登录
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
