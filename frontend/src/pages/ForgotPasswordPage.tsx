// P5.2 忘记密码页: 输入邮箱 → 触发后端 forgot-password → 邮件
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowLeft, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { authApi } from '@/api/auth';
import { Button, Input, Label } from '@/components/ui';
import { toast } from 'sonner';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    try {
      const r = await authApi.forgotPassword(email.trim());
      setSubmitted(true);
      // dev 环境会返 reset_url, 方便 E2E 测
      if (r.reset_url) {
        setDevResetUrl(r.reset_url);
      }
    } catch (e: any) {
      toast.error(e?.message || '请求失败, 请稍后重试');
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
            <Sparkles className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">重置密码</h1>
          <p className="text-xs text-muted-foreground mt-1">
            输入注册邮箱, 我们会发送重置链接
          </p>
        </div>

        {/* 表单 / 成功 */}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          {!submitted ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">邮箱</Label>
                <div className="relative">
                  <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="pl-8"
                    disabled={loading}
                  />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={loading || !email.trim()}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    发送中…
                  </>
                ) : (
                  '发送重置链接'
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
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col items-center text-center py-2">
                <div className="h-10 w-10 rounded-full bg-green-50 text-green-600 flex items-center justify-center mb-2">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <h2 className="text-sm font-medium">重置链接已发送</h2>
                <p className="text-xs text-muted-foreground mt-1 max-w-[280px]">
                  如果 <span className="font-mono">{email}</span> 是注册邮箱,
                  重置链接会在几分钟内到达. 请检查收件箱 (含垃圾邮件).
                </p>
              </div>

              {devResetUrl && (
                <div className="rounded-md border border-dashed border-amber-300 bg-amber-50 p-3 text-xs space-y-1.5">
                  <p className="font-medium text-amber-900">🛠 DEV 环境</p>
                  <p className="text-amber-800">邮件未真发, 点击下方链接直接重置:</p>
                  <a
                    href={new URL(devResetUrl).pathname + new URL(devResetUrl).search}
                    className="block break-all text-amber-700 hover:underline font-mono text-[11px]"
                  >
                    {devResetUrl}
                  </a>
                </div>
              )}

              <div className="flex flex-col gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSubmitted(false);
                    setDevResetUrl(null);
                  }}
                >
                  重新输入邮箱
                </Button>
                <Link to="/login">
                  <Button variant="ghost" size="sm" className="w-full">
                    <ArrowLeft className="mr-1.5 h-3 w-3" />
                    返回登录
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-[10px] text-muted-foreground mt-4">
          重置链接 1 小时内有效
        </p>
      </div>
    </div>
  );
}
