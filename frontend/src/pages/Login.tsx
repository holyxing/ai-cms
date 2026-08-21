import { useState, useEffect, useRef, type FormEvent, type MouseEvent } from 'react';
import { useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom';
import {
  Loader2,
  Mail,
  Lock,
  ArrowRight,
  Sparkles,
  FileText,
  Globe,
  PenLine,
  Rocket,
  Layers,
} from 'lucide-react';
import { toast } from 'sonner';

import { authApi } from '@/api/auth';
import { useAuthStore } from '@/stores/auth';
import { Button, Input, Label } from '@/components/ui';

const NODES = [
  { x: '22%', y: '28%', delay: '0s' },
  { x: '72%', y: '22%', delay: '1.5s' },
  { x: '46%', y: '62%', delay: '3s' },
  { x: '82%', y: '68%', delay: '4.5s' },
  { x: '16%', y: '72%', delay: '6s' },
  { x: '62%', y: '42%', delay: '7.5s' },
  { x: '34%', y: '88%', delay: '9s' },
] as const;

const EDGES: Array<[number, number]> = [
  [0, 1], [1, 5], [5, 3], [0, 2], [2, 4], [2, 3], [6, 4],
];

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const login = useAuthStore((s) => s.login);
  const accessToken = useAuthStore((s) => s.accessToken);

  const [email, setEmail] = useState('admin@admin.com');
  const [password, setPassword] = useState('admin123456');
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // P3.9.5+ (holy 反馈): 登录后默认跳 /dashboard
  // 优先级: ?next= (URL query) > state.from.pathname > /dashboard
  // 安全: next/from 必须是站内相对路径 (以 / 开头, 不含 // 协议前缀), 防止 open redirect
  const rawNext =
    searchParams.get('next') ||
    (location.state as { from?: { pathname: string } })?.from?.pathname ||
    '/dashboard';
  const isSafePath = (p: string) => typeof p === 'string' && p.startsWith('/') && !p.startsWith('//');
  const from = isSafePath(rawNext) ? rawNext : '/dashboard';

  // 已登录访问 /login → 直接跳 dashboard (避免重复登录)
  useEffect(() => {
    if (accessToken) {
      navigate(from, { replace: true });
    }
  }, [accessToken, from, navigate]);

  const onPanelMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = panelRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--spot-x', `${((e.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty('--spot-y', `${((e.clientY - r.top) / r.height) * 100}%`);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await authApi.login({ email, password });
      // P5.4 2FA: 如果返 challenge_token, 跳到 2FA 验证步骇
      if (data.requires_2fa && data.challenge_token) {
        // 用 searchParams 传 challenge_token 到下一个页 (跨路由不用 state 防止丢失)
        navigate(`/login/2fa?challenge=${encodeURIComponent(data.challenge_token)}&next=${encodeURIComponent(from)}`, { replace: true });
        return;
      }
      login(data);
      toast.success(`欢迎回来, ${data.user!.name}`);
      navigate(from, { replace: true });
    } catch {
      // axios 拦截器已经 toast
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* === 左侧: 浅色 + 抽象动图 + 最上层文字 === */}
      <div
        ref={panelRef}
        onMouseMove={onPanelMove}
        className="relative hidden overflow-hidden bg-gradient-to-br from-sky-50/80 via-white to-blue-50/60 lg:block"
        style={{ ['--spot-x' as string]: '42%', ['--spot-y' as string]: '38%' }}
      >
        {/* 极光 (科技蓝, 低饱和) */}
        <div
          className="absolute -left-32 -top-32 h-[480px] w-[480px] rounded-full opacity-50 blur-[120px]"
          style={{
            background: 'radial-gradient(circle, #7dd3fc 0%, transparent 70%)',
            animation: 'aurora-1 18s ease-in-out infinite',
          }}
        />
        <div
          className="absolute -bottom-32 -right-32 h-[520px] w-[520px] rounded-full opacity-40 blur-[140px]"
          style={{
            background: 'radial-gradient(circle, #93c5fd 0%, transparent 70%)',
            animation: 'aurora-2 22s ease-in-out infinite',
          }}
        />
        <div
          className="absolute left-1/3 top-1/2 h-[400px] w-[400px] rounded-full opacity-30 blur-[120px]"
          style={{
            background: 'radial-gradient(circle, #bae6fd 0%, transparent 70%)',
            animation: 'aurora-3 26s ease-in-out infinite',
          }}
        />

        {/* 鼠标跟随光斑 */}
        <div
          className="pointer-events-none absolute inset-0 opacity-70 transition-[background] duration-300"
          style={{
            background:
              'radial-gradient(420px circle at var(--spot-x) var(--spot-y), rgb(37 99 235 / 0.12), transparent 55%)',
          }}
        />

        {/* 竖向扫描光带 */}
        <div
          className="pointer-events-none absolute inset-x-0 h-40 bg-gradient-to-b from-transparent via-sky-400/10 to-transparent"
          style={{ animation: 'login-scan 9s ease-in-out infinite' }}
        />

        {/* 中心轨道环 */}
        <div className="pointer-events-none absolute left-1/2 top-[46%] h-[280px] w-[280px] -translate-x-1/2 -translate-y-1/2">
          <div
            className="absolute inset-0 rounded-full border border-sky-400/20"
            style={{ animation: 'login-orbit 48s linear infinite' }}
          />
          <div
            className="absolute inset-6 rounded-full border border-dashed border-blue-400/15"
            style={{ animation: 'login-orbit 64s linear infinite reverse' }}
          />
          <div className="absolute inset-[52px] rounded-full border border-sky-300/10" />
        </div>

        {/* 网格 + 节点 (抽象, 浅色) */}
        <svg className="absolute inset-0 h-full w-full opacity-60" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="56" height="56" patternUnits="userSpaceOnUse">
              <path d="M 56 0 L 0 0 0 56" fill="none" stroke="rgb(14 165 233 / 0.18)" strokeWidth="0.5" />
            </pattern>
            <radialGradient id="node-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgb(37 99 235)" stopOpacity="0.85" />
              <stop offset="100%" stopColor="rgb(14 165 233)" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="edge-flow" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgb(14 165 233)" stopOpacity="0" />
              <stop offset="50%" stopColor="rgb(37 99 235)" stopOpacity="0.7" />
              <stop offset="100%" stopColor="rgb(14 165 233)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
          {/* 连接线：底线 + 流动虚线 */}
          {EDGES.map(([a, b], i) => {
            const n0 = NODES[a];
            const n1 = NODES[b];
            return (
              <g key={i}>
                <line
                  x1={n0.x} y1={n0.y} x2={n1.x} y2={n1.y}
                  stroke="rgb(14 165 233 / 0.2)" strokeWidth="0.5"
                />
                <line
                  x1={n0.x} y1={n0.y} x2={n1.x} y2={n1.y}
                  stroke="url(#edge-flow)" strokeWidth="1.25"
                  strokeDasharray="6 10"
                  style={{ animation: `login-dash-flow ${2.4 + i * 0.25}s linear infinite` }}
                />
              </g>
            );
          })}
          {/* 节点 */}
          {NODES.map((n, i) => (
            <g key={i} style={{ animation: `node-pulse 4s ease-in-out ${n.delay} infinite` }}>
              <circle cx={n.x} cy={n.y} r="12" fill="url(#node-glow)" />
              <circle cx={n.x} cy={n.y} r="3.5" fill="rgb(37 99 235)" opacity="0.85" />
              <circle cx={n.x} cy={n.y} r="1.5" fill="white" opacity="0.9" />
            </g>
          ))}
        </svg>

        {/* 顶部 logo */}
        <div className="relative z-10 flex h-16 items-center px-8">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} />
          </div>
          <span className="ml-2 text-sm font-semibold tracking-tight text-foreground">AI-CMS</span>
          <span className="ml-2 rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-sky-700">
            SSG
          </span>
        </div>

        {/* === 最上层: 纯文字说明 === */}
        <div className="relative z-10 flex h-[calc(100vh-8rem)] flex-col items-center justify-center px-10 text-center">
          <div className="max-w-md">
            <div
              className="login-fade-up mb-6 inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.2em] text-sky-600/80"
              style={{ animationDelay: '60ms' }}
            >
              <span className="h-px w-6 bg-sky-600/40" />
              AI-CMS · SSG
              <span className="h-px w-6 bg-sky-600/40" />
            </div>

            <h2
              className="login-fade-up text-[40px] font-semibold leading-[1.1] tracking-[-0.02em] text-foreground"
              style={{ animationDelay: '140ms' }}
            >
              <span className="block">AI 加持的</span>
              <span className="login-title-gradient block">多站点 CMS</span>
            </h2>

            <p
              className="login-fade-up mt-5 text-[15px] leading-relaxed text-muted-foreground"
              style={{ animationDelay: '240ms' }}
            >
              AI 辅助写作 · 富文本块编辑 · 一键静态发布<br />
              一个后台管理所有内容站点
            </p>

            <div
              className="login-fade-up mt-12 flex items-center justify-center gap-0 text-[12px] text-foreground/70"
              style={{ animationDelay: '340ms' }}
            >
              <div className="flex flex-col items-center px-4">
                <span className="font-mono-xs font-semibold text-sky-600">01</span>
                <span className="mt-1.5 font-medium text-foreground">AI 写作</span>
                <span className="mt-0.5 text-[11px] text-muted-foreground">起稿 · 改写</span>
              </div>
              <span className="h-8 w-px bg-border" />
              <div className="flex flex-col items-center px-4">
                <span className="font-mono-xs font-semibold text-blue-600">02</span>
                <span className="mt-1.5 font-medium text-foreground">块编辑器</span>
                <span className="mt-0.5 text-[11px] text-muted-foreground">Tiptap 富文本</span>
              </div>
              <span className="h-8 w-px bg-border" />
              <div className="flex flex-col items-center px-4">
                <span className="font-mono-xs font-semibold text-cyan-600">03</span>
                <span className="mt-1.5 font-medium text-foreground">静态发布</span>
                <span className="mt-0.5 text-[11px] text-muted-foreground">Astro · CDN</span>
              </div>
            </div>
          </div>
        </div>

        <div className="absolute bottom-6 left-0 right-0 z-10 text-center text-[10px] tracking-wider text-muted-foreground/60">
          v0.1.0 · 2026
        </div>
      </div>

      {/* === 右侧: 表单 + 创作/发布氛围 === */}
      <div className="relative flex flex-col overflow-hidden bg-gradient-to-br from-sky-50 via-white to-blue-50/80">
        {/* 点阵底纹 */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.45]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgb(37 99 235 / 0.14) 1px, transparent 0)',
            backgroundSize: '20px 20px',
          }}
        />
        {/* 右侧柔光 */}
        <div
          className="pointer-events-none absolute -right-24 top-16 h-72 w-72 rounded-full opacity-50 blur-[90px]"
          style={{ background: 'radial-gradient(circle, #93c5fd 0%, transparent 70%)' }}
        />
        <div
          className="pointer-events-none absolute -left-16 bottom-24 h-56 w-56 rounded-full opacity-40 blur-[80px]"
          style={{ background: 'radial-gradient(circle, #7dd3fc 0%, transparent 70%)' }}
        />

        {/* 漂浮：内容创作 / 站点发布示意卡 */}
        <div className="pointer-events-none absolute inset-0 hidden lg:block" aria-hidden>
          <div
            className="absolute left-8 top-24 w-44 rounded-md border border-sky-200/80 bg-white/90 p-3 shadow-sm backdrop-blur-sm"
            style={{ animation: 'float-card 6s ease-in-out infinite' }}
          >
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-sky-700">
              <FileText className="h-3.5 w-3.5" strokeWidth={2} />
              内容创作
            </div>
            <div className="space-y-1.5">
              <div className="h-1.5 w-[80%] rounded-sm bg-sky-100" />
              <div className="h-1.5 w-full rounded-sm bg-secondary" />
              <div className="h-1.5 w-[60%] rounded-sm bg-secondary" />
            </div>
            <div className="mt-2.5 flex items-center gap-1 text-[10px] text-muted-foreground">
              <PenLine className="h-3 w-3 text-primary" />
              AI 辅助起稿
            </div>
          </div>

          <div
            className="absolute right-6 top-36 w-40 rounded-md border border-blue-200/80 bg-white/90 p-3 shadow-sm backdrop-blur-sm"
            style={{ animation: 'float-card 7.5s ease-in-out 0.8s infinite' }}
          >
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-blue-700">
              <Globe className="h-3.5 w-3.5" strokeWidth={2} />
              站点预览
            </div>
            <div className="overflow-hidden rounded-sm border border-border bg-sky-50/80">
              <div className="flex h-4 items-center gap-1 border-b border-border/80 bg-white px-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-sky-300" />
                <span className="h-1.5 w-1.5 rounded-full bg-sky-200" />
                <span className="ml-1 h-1 flex-1 rounded-sm bg-secondary" />
              </div>
              <div className="space-y-1 p-1.5">
                <div className="h-4 rounded-sm bg-primary/15" />
                <div className="h-1 w-full rounded-sm bg-secondary" />
                <div className="h-1 w-2/3 rounded-sm bg-secondary" />
              </div>
            </div>
          </div>

          <div
            className="absolute bottom-28 left-10 right-10 mx-auto flex max-w-sm items-center justify-between rounded-md border border-sky-200/70 bg-white/85 px-3 py-2 shadow-sm backdrop-blur-sm"
            style={{ animation: 'float-card 8s ease-in-out 1.2s infinite' }}
          >
            {[
              { icon: PenLine, label: '创作' },
              { icon: Layers, label: '编排' },
              { icon: Rocket, label: '发布' },
              { icon: Globe, label: '上线' },
            ].map((step, i) => (
              <div key={step.label} className="flex items-center gap-2">
                {i > 0 && <span className="mr-1 h-px w-4 bg-sky-200" />}
                <div className="flex flex-col items-center gap-1">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-sky-50 text-primary">
                    <step.icon className="h-3.5 w-3.5" strokeWidth={2} />
                  </div>
                  <span className="text-[10px] font-medium text-foreground/80">{step.label}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <header className="relative z-10 flex h-16 items-center px-6 lg:hidden">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} />
          </div>
          <span className="ml-2 text-sm font-semibold">AI-CMS</span>
        </header>

        <main className="relative z-10 flex flex-1 items-center justify-center px-6 py-10">
          <div className="login-fade-up w-full max-w-[340px]" style={{ animationDelay: '80ms' }}>
            <div className="mb-6">
              <div className="mb-3 hidden h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm lg:flex">
                <Sparkles className="h-4 w-4" strokeWidth={2.5} />
              </div>
              <h1 className="text-xl font-semibold tracking-tight">登录</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                创作内容 · 管理站点 · 一键发布
              </p>
            </div>

            <div className="mb-4 grid grid-cols-3 gap-2 lg:hidden">
              {[
                { icon: PenLine, label: '创作' },
                { icon: FileText, label: '内容' },
                { icon: Rocket, label: '发布' },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex flex-col items-center gap-1 rounded-md border border-sky-200/80 bg-white/80 py-2 shadow-sm"
                >
                  <item.icon className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
                  <span className="text-[11px] font-medium text-foreground">{item.label}</span>
                </div>
              ))}
            </div>

            <form
              onSubmit={handleSubmit}
              className="space-y-3 rounded-md border border-sky-200/80 bg-white/95 p-5 shadow-sm backdrop-blur-sm"
            >
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-medium">邮箱</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    className="h-9 border-sky-100 bg-sky-50/40 pl-8 text-sm transition-shadow focus-visible:shadow-[0_0_0_3px_rgb(37_99_235_/_0.12)]"
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-xs font-medium">密码</Label>
                  <Link
                    to="/forgot-password"
                    className="text-[11px] text-muted-foreground transition-colors hover:text-primary"
                  >
                    忘记密码?
                  </Link>
                </div>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    minLength={8}
                    className="h-9 border-sky-100 bg-sky-50/40 pl-8 text-sm transition-shadow focus-visible:shadow-[0_0_0_3px_rgb(37_99_235_/_0.12)]"
                    disabled={loading}
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="h-9 w-full gap-1.5 text-sm shadow-sm transition-opacity hover:opacity-95"
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    登录
                    <ArrowRight className="h-3.5 w-3.5" />
                  </>
                )}
              </Button>
            </form>

            <p className="mt-5 text-center text-xs text-muted-foreground">
              还没有账号?{' '}
              <Link to="/register" className="font-medium text-primary hover:underline">
                注册
              </Link>
            </p>
          </div>
        </main>

        <footer className="relative z-10 flex h-10 items-center justify-between border-t border-sky-100/80 bg-white/60 px-6 text-[11px] text-muted-foreground backdrop-blur-sm">
          <span>© 2026 AI-CMS</span>
          <div className="flex items-center gap-4">
            <a href="#" className="hover:text-foreground">文档</a>
            <a href="#" className="hover:text-foreground">支持</a>
          </div>
        </footer>
      </div>
    </div>
  );
}
