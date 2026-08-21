// SiteBlocksPanel.tsx - 首页块配置面板 (P3.6.5+)
// 在 LayoutEditPage 右侧栏显示, 让 Holy 改 Hero/Stats/Products/CTA 不进 HTML
// 改完 → PUT /sites/{id}/blocks/{name} → 写 site.settings
// 发版后生效 (前端即时反馈, 发布后才在静态站点可见)
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Plus, Trash2, Loader2, AlertCircle } from 'lucide-react';
import { Button, Input, Label, Card, CardContent, Badge } from '@/components/ui';
import { sitesApi } from '@/api/sites';
import { toast } from 'sonner';

type BlockName = 'hero' | 'stats' | 'products' | 'cta';

const BLOCK_META: Record<BlockName, { label: string; emoji: string; desc: string }> = {
  hero: { label: 'Hero 区', emoji: '🎯', desc: '首页顶部大标题 + 2 个 CTA 按钮' },
  stats: { label: '数字统计', emoji: '📊', desc: '4 个动画数字' },
  products: { label: '产品卡', emoji: '🧩', desc: '3 个产品/服务介绍' },
  cta: { label: '底部 CTA', emoji: '🚀', desc: '底部行动召唤' },
};

interface SiteBlocksPanelProps {
  siteId: string;
  /** 块级模板是否在本 layout 用, 决定要不要显示某个块 (UI 简化: 显示全部, 不在用会忽略) */
  enabled?: BlockName[];
}

export function SiteBlocksPanel({ siteId, enabled = ['hero', 'stats', 'cta'] }: SiteBlocksPanelProps) {
  const qc = useQueryClient();
  const [openBlocks, setOpenBlocks] = useState<Set<BlockName>>(new Set());

  const blocksQ = useQuery({
    queryKey: ['site-blocks', siteId],
    queryFn: () => sitesApi.getBlocks(siteId).catch(() => null),
    enabled: !!siteId,
  });

  const updateMut = useMutation({
    mutationFn: ({ name, content }: { name: BlockName; content: any }) =>
      sitesApi.updateBlock(siteId, name, content),
    onSuccess: (_d, vars) => {
      toast.success(`${BLOCK_META[vars.name].label} 已保存, 发版后生效`);
      qc.invalidateQueries({ queryKey: ['site-blocks', siteId] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '保存失败'),
  });

  const toggleBlock = (name: BlockName) => {
    const next = new Set(openBlocks);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setOpenBlocks(next);
  };

  if (blocksQ.isLoading) {
    return (
      <Card className="shadow-sm">
        <CardContent className="p-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />加载块配置…
        </CardContent>
      </Card>
    );
  }
  if (blocksQ.isError) {
    return (
      <Card className="shadow-sm border-destructive/30">
        <CardContent className="p-4 flex items-center gap-2 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5" />块配置加载失败
        </CardContent>
      </Card>
    );
  }

  const data = blocksQ.data || {};

  return (
    <Card className="shadow-sm">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium flex items-center gap-1.5">
            <span>🧱</span>
            首页块配置
          </p>
          <Badge variant="muted" className="text-[10px]">P3.6.5+</Badge>
        </div>
        <p className="text-[10.5px] text-muted-foreground leading-relaxed">
          改完<b>点保存</b>写入 site.settings, 需<b>发版</b>才在静态站点生效
        </p>
        <div className="space-y-1 pt-1">
          {enabled.map((name) => (
            <BlockRow
              key={name}
              name={name}
              data={data[name]}
              isOpen={openBlocks.has(name)}
              onToggle={() => toggleBlock(name)}
              onSave={(content) => updateMut.mutate({ name, content })}
              isSaving={updateMut.isPending && updateMut.variables?.name === name}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// 单个块的折叠行 + 编辑表单
// ===========================================================================

interface BlockRowProps {
  name: BlockName;
  data: any;
  isOpen: boolean;
  onToggle: () => void;
  onSave: (content: any) => void;
  isSaving: boolean;
}

function BlockRow({ name, data, isOpen, onToggle, onSave, isSaving }: BlockRowProps) {
  const meta = BLOCK_META[name];
  const [draft, setDraft] = useState<any>(data || {});

  // 同步远端 → draft
  useState(() => {
    if (data) setDraft(data);
  });
  // 用 effect 同步 (避免初始化时机问题)
  if (data && JSON.stringify(data) !== JSON.stringify(draft) && !isOpen) {
    setDraft(data);
  }

  return (
    <div className="rounded-md border bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-secondary/40"
      >
        <span className="text-sm leading-none">{meta.emoji}</span>
        <span className="flex-1 text-[12px] font-medium">{meta.label}</span>
        {data ? (
          <Badge variant="muted" className="text-[9.5px]">已配置</Badge>
        ) : (
          <Badge variant="muted" className="text-[9.5px] text-amber-600">空</Badge>
        )}
        {isOpen ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
      </button>
      {isOpen && (
        <div className="border-t bg-secondary/20 px-2.5 py-2.5 space-y-2.5">
          {name === 'hero' && <HeroForm draft={draft} setDraft={setDraft} />}
          {name === 'stats' && <StatsForm draft={draft} setDraft={setDraft} />}
          {name === 'products' && <ProductsForm draft={draft} setDraft={setDraft} />}
          {name === 'cta' && <CtaForm draft={draft} setDraft={setDraft} />}
          <div className="flex justify-end gap-1.5 pt-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => setDraft(data || {})}
              disabled={isSaving}
            >
              重置
            </Button>
            <Button
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => onSave(draft)}
              disabled={isSaving || !draft.title}
            >
              {isSaving && <Loader2 className="h-3 w-3 animate-spin" />}
              保存
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// 4 个块的表单 (复用: Input + Label + 紧凑布局)
// ===========================================================================

function HeroForm({ draft, setDraft }: { draft: any; setDraft: (d: any) => void }) {
  const c1 = draft.cta_primary || {};
  const c2 = draft.cta_secondary || {};
  return (
    <div className="space-y-2">
      <Field label="徽章" hint="顶部小标签">
        <Input value={draft.badge || ''} onChange={(e) => setDraft({ ...draft, badge: e.target.value })} className="h-7 text-[12px]" placeholder="以 AI 为引擎 · 助力数据要素化" />
      </Field>
      <Field label="标题 *" hint="主标题 H1">
        <Input value={draft.title || ''} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="h-7 text-[12px]" placeholder="霍因科技" />
      </Field>
      <Field label="副标题" hint="slogan">
        <Input value={draft.subtitle || ''} onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })} className="h-7 text-[12px]" placeholder="以 AI 为引擎的数据要素化..." />
      </Field>
      <Field label="描述" hint="1-2 句话">
        <Input value={draft.desc || ''} onChange={(e) => setDraft({ ...draft, desc: e.target.value })} className="h-7 text-[12px]" placeholder="助力客户实现..." />
      </Field>
      <div className="rounded border bg-card p-2 space-y-1.5">
        <p className="text-[10.5px] font-medium text-muted-foreground">主按钮 (CTA 1)</p>
        <Input value={c1.label || ''} onChange={(e) => setDraft({ ...draft, cta_primary: { ...c1, label: e.target.value } })} className="h-7 text-[12px]" placeholder="了解产品" />
        <Input value={c1.href || ''} onChange={(e) => setDraft({ ...draft, cta_primary: { ...c1, href: e.target.value } })} className="h-7 text-[12px]" placeholder="/product/" />
      </div>
      <div className="rounded border bg-card p-2 space-y-1.5">
        <p className="text-[10.5px] font-medium text-muted-foreground">次按钮 (CTA 2, 可留空)</p>
        <Input value={c2.label || ''} onChange={(e) => setDraft({ ...draft, cta_secondary: { ...c2, label: e.target.value } })} className="h-7 text-[12px]" placeholder="联系销售" />
        <Input value={c2.href || ''} onChange={(e) => setDraft({ ...draft, cta_secondary: { ...c2, href: e.target.value } })} className="h-7 text-[12px]" placeholder="/contact/" />
      </div>
    </div>
  );
}

function StatsForm({ draft, setDraft }: { draft: any; setDraft: (d: any) => void }) {
  const items: any[] = draft.items || [];
  const update = (idx: number, patch: any) => {
    const next = items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
    setDraft({ ...draft, items: next });
  };
  const add = () => setDraft({ ...draft, items: [...items, { value: 0, suffix: '', label: '新数字' }] });
  const remove = (idx: number) => setDraft({ ...draft, items: items.filter((_, i) => i !== idx) });
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-1 rounded border bg-card p-1.5">
          <Input type="number" value={it.value} onChange={(e) => update(i, { value: +e.target.value })} className="h-7 w-16 text-[12px]" />
          <Input value={it.suffix} onChange={(e) => update(i, { suffix: e.target.value })} className="h-7 w-14 text-[12px]" placeholder="+ / %" />
          <Input value={it.label} onChange={(e) => update(i, { label: e.target.value })} className="h-7 flex-1 text-[12px]" placeholder="标签" />
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => remove(i)}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button variant="ghost" size="sm" className="h-7 w-full text-[11px] text-muted-foreground" onClick={add}>
        <Plus className="h-3 w-3" />加一个数字
      </Button>
    </div>
  );
}

function ProductsForm({ draft, setDraft }: { draft: any; setDraft: (d: any) => void }) {
  const items: any[] = draft.items || [];
  const update = (idx: number, patch: any) => setDraft({ ...draft, items: items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) });
  const add = () => setDraft({ ...draft, items: [...items, { name: '新产品', desc: '', href: '', icon: '🆕' }] });
  const remove = (idx: number) => setDraft({ ...draft, items: items.filter((_, i) => i !== idx) });
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={i} className="rounded border bg-card p-2 space-y-1">
          <div className="flex items-center gap-1">
            <Input value={it.icon} onChange={(e) => update(i, { icon: e.target.value })} className="h-7 w-10 text-[12px] text-center" placeholder="🅰" />
            <Input value={it.name} onChange={(e) => update(i, { name: e.target.value })} className="h-7 flex-1 text-[12px]" placeholder="产品名" />
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => remove(i)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          <Input value={it.href || ''} onChange={(e) => update(i, { href: e.target.value })} className="h-7 text-[12px]" placeholder="链接 /products/hao/ (留空则不可点)" />
          <Input value={it.desc || ''} onChange={(e) => update(i, { desc: e.target.value })} className="h-7 text-[12px]" placeholder="一句话描述" />
        </div>
      ))}
      <Button variant="ghost" size="sm" className="h-7 w-full text-[11px] text-muted-foreground" onClick={add}>
        <Plus className="h-3 w-3" />加一个产品
      </Button>
    </div>
  );
}

function CtaForm({ draft, setDraft }: { draft: any; setDraft: (d: any) => void }) {
  return (
    <div className="space-y-2">
      <Field label="标题 *" hint="底部 CTA 大标题">
        <Input value={draft.title || ''} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="h-7 text-[12px]" placeholder="开启您的数据要素化之旅" />
      </Field>
      <Field label="描述" hint="1 句话">
        <Input value={draft.desc || ''} onChange={(e) => setDraft({ ...draft, desc: e.target.value })} className="h-7 text-[12px]" placeholder="让霍因科技..." />
      </Field>
      <Field label="按钮文本">
        <Input value={draft.cta_label || ''} onChange={(e) => setDraft({ ...draft, cta_label: e.target.value })} className="h-7 text-[12px]" placeholder="免费咨询" />
      </Field>
      <Field label="按钮链接">
        <Input value={draft.cta_href || ''} onChange={(e) => setDraft({ ...draft, cta_href: e.target.value })} className="h-7 text-[12px]" placeholder="/contact/" />
      </Field>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10.5px] font-medium text-muted-foreground flex items-center justify-between">
        <span>{label}</span>
        {hint && <span className="text-[9.5px] text-muted-foreground/70 font-normal">{hint}</span>}
      </Label>
      {children}
    </div>
  );
}
