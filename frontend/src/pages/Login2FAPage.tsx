// P5.4 2FA Login 第二步: 输入 6 位 TOTP 码 或 recovery code
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { ArrowLeft, Loader2, ShieldCheck, KeyRound, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { authApi } from '@/api/auth';
import { useAuthStore } from '@/stores/auth';
import { Button, Input, Label } from '@/components/ui';

export function Login2FAPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const challengeToken = searchParams.get('challenge') || '';
  const next = searchParams.get('next') || '/dashboard';
  const login = useAuthStore((s) => s.login);
  const accessToken = useAuthStore((s) => s.accessToken);

  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp');

  // 已登录访问 → 直接跳
  useEffect(() => {
    if (accessToken) {
      navigate(next, { replace: true });
    }
  }, [accessToken, next, navigate]);

  // 没 challenge_token 跳回 login
  useEffect(() => {
    if (!challengeToken) {
      toast.error('登录挑战已过期, 请重新登录');
      navigate('/login', { replace: true });
    }
  }, [challengeToken, navigate]);

  const handleTotpSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      toast.error('请输入 6 位数字码');
      return;
    }
    setLoading(true);
    try {
      const data = await authApi.verify2FA(challengeToken, code);
      if (!data.access_token) {
        throw new Error('2FA 验证失败');
      }
      login(data);
      toast.success('两步验证通过, 欢迎回来');
      navigate(next, { replace: true });
    } catch (e: any) {
      // axios 拦截器已经 toast
    } finally {
      setLoading(false);
    }
  };

  const handleRecoverySubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!recoveryCode.trim()) {
      toast.error('请输入 recovery code');
      return;
    }
    setLoading(true);
    try {
      const data = await authApi.recover2FA(challengeToken, recoveryCode.trim());
      if (!data.access_token) {
        throw new Error('Recovery code 无效');
      }
      login(data);
      toast.success(`两步验证通过 (剩 ${data.recovery_codes_remaining} 个 recovery code)`);
      navigate(next, { replace: true });
    } catch (e: any) {
      // axios 拦截器已经 toast
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-[420px]">
        {/* Logo + 标题 */}
        <div className="text-center mb-6">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary mb-3">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">两步验证</h1>
          <p className="text-xs text-muted-foreground mt-1">
            {mode === 'totp'
              ? '打开 authenticator app 输入 6 位码'
              : '输入一次性 recovery code'}
          </p>
        </div>

        {/* 表单 */}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          {mode === 'totp' ? (
            <form onSubmit={handleTotpSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="code" className="text-xs">6 位验证码</Label>
                <Input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className="text-center text-lg tracking-widest font-mono"
                  autoFocus
                  required
                  disabled={loading}
                />
                <p className="text-[11px] text-muted-foreground">
                  验证码每 30 秒刷新一次
                </p>
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                验证
              </Button>

              <div className="relative my-3">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">或</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setMode('recovery')}
                className="w-full text-xs text-muted-foreground hover:text-primary inline-flex items-center justify-center gap-1.5"
              >
                <KeyRound className="h-3 w-3" />
                使用 recovery code
              </button>
            </form>
          ) : (
            <form onSubmit={handleRecoverySubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="recovery" className="text-xs">Recovery Code</Label>
                <Input
                  id="recovery"
                  type="text"
                  placeholder="XXXX-XXXX"
                  value={recoveryCode}
                  onChange={(e) => setRecoveryCode(e.target.value.toUpperCase())}
                  className="text-center text-base font-mono tracking-wider"
                  autoFocus
                  required
                  disabled={loading}
                />
                <p className="text-[11px] text-muted-foreground">
                  格式 4-4 字符, 一次性使用
                </p>
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                验证
              </Button>

              <button
                type="button"
                onClick={() => setMode('totp')}
                className="w-full text-xs text-muted-foreground hover:text-primary inline-flex items-center justify-center gap-1.5"
              >
                <ShieldCheck className="h-3 w-3" />
                使用 authenticator 验证码
              </button>
            </form>
          )}
        </div>

        {/* 返回登录 */}
        <div className="mt-4 text-center">
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            返回登录
          </Link>
        </div>
      </div>
    </div>
  );
}