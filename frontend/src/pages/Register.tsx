import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { authApi } from '@/api/auth';
import { useAuthStore } from '@/stores/auth';
import { Button, Input, Label, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui';

export function RegisterPage() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await authApi.register({ email, name, password });
      if (r.is_first_user) {
        toast.success('注册成功! 你是第一个用户, 已自动成为超管。');
      } else {
        toast.success('注册成功! 请登录。');
      }
      navigate('/login');
    } catch {
      // axios 已 toast
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl">注册账号</CardTitle>
          <CardDescription>创建你的 AI-CMS 账号</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">姓名</Label>
              <Input
                id="name"
                type="text"
                placeholder="你的名字"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={1}
                maxLength={100}
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码 (至少 8 位)</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                disabled={loading}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              注册
            </Button>
          </form>
          <div className="mt-4 text-center text-sm text-muted-foreground">
            已有账号?{' '}
            <Link to="/login" className="text-primary hover:underline">
              立即登录
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
