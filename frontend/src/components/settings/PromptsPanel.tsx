/**
 * AI 提示词管理面板 — 设置中心
 * 超管可改/重置/导出导入；登录用户可浏览。
 */
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Download, Upload, RotateCcw, Save, Loader2, Search, FileText,
} from 'lucide-react';
import { Button, Badge, Label } from '@/components/ui';
import { cn } from '@/lib/utils';
import { aiApi, type AIPromptItem } from '@/api/ai';
import { useAuthStore } from '@/stores/auth';
import { toast } from 'sonner';

const CATEGORY_LABEL: Record<string, string> = {
  task: '任务',
  quick: '快捷操作',
  enhance: 'HTML 增强',
  import: '文档导入',
};

export function PromptsPanel() {
  const user = useAuthStore((s) => s.user);
  const canEdit = !!user?.is_super_admin;
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<string>('all');
  const [q, setQ] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['ai-prompts'],
    queryFn: () => aiApi.listPrompts(),
  });

  const items = data?.items ?? [];
  const filtered = useMemo(() => {
    return items.filter((p) => {
      if (category !== 'all' && p.category !== category) return false;
      if (!q.trim()) return true;
      const s = q.trim().toLowerCase();
      return (
        p.key.toLowerCase().includes(s) ||
        p.label.toLowerCase().includes(s) ||
        (p.description || '').toLowerCase().includes(s)
      );
    });
  }, [items, category, q]);

  const selected = items.find((p) => p.key === selectedKey) || null;

  const select = (p: AIPromptItem) => {
    setSelectedKey(p.key);
    setDraft(p.content);
  };

  const saveMut = useMutation({
    mutationFn: () => aiApi.updatePrompt(selectedKey!, draft),
    onSuccess: (row) => {
      toast.success('已保存');
      qc.invalidateQueries({ queryKey: ['ai-prompts'] });
      setDraft(row.content);
    },
    onError: (e: Error) => toast.error(e.message || '保存失败'),
  });

  const resetMut = useMutation({
    mutationFn: () => aiApi.resetPrompt(selectedKey!),
    onSuccess: (row) => {
      toast.success('已重置为内置版本');
      qc.invalidateQueries({ queryKey: ['ai-prompts'] });
      setDraft(row.content);
    },
    onError: (e: Error) => toast.error(e.message || '重置失败'),
  });

  const exportJson = async () => {
    try {
      const bundle = await aiApi.exportPrompts();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai-cms-prompts-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('已导出');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '导出失败');
    }
  };

  const onImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const json = JSON.parse(text) as { items?: Record<string, unknown>[] };
      const list = Array.isArray(json.items) ? json.items : Array.isArray(json) ? json : null;
      if (!list) {
        toast.error('JSON 需含 items 数组');
        return;
      }
      const stats = await aiApi.importPrompts(list as Record<string, unknown>[], true);
      toast.success(`导入完成：新增 ${stats.created} / 更新 ${stats.updated} / 跳过 ${stats.skipped}`);
      qc.invalidateQueries({ queryKey: ['ai-prompts'] });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '导入失败');
    }
  };

  const dirty = selected ? draft !== selected.content : false;

  return (
    <div className="flex h-full min-h-[480px] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索 key / 名称"
            className="h-8 w-full rounded-md border bg-background pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-xs"
        >
          <option value="all">全部分类</option>
          {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <Button variant="outline" size="sm" className="h-8 gap-1 text-[11px]" onClick={exportJson}>
          <Download className="h-3 w-3" />
          导出
        </Button>
        {canEdit && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onImportFile(f);
                e.target.value = '';
              }}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1 text-[11px]"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-3 w-3" />
              导入
            </Button>
          </>
        )}
      </div>

      {!canEdit && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-2.5 py-1.5">
          当前为只读。修改 / 重置 / 导入需超管账号。
        </p>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-[240px_1fr]">
        <div className="overflow-y-auto rounded-md border bg-card">
          {isLoading && (
            <div className="flex items-center gap-2 p-3 text-[11px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              加载中…
            </div>
          )}
          {!isLoading && filtered.length === 0 && (
            <p className="p-3 text-[11px] text-muted-foreground">无匹配提示词</p>
          )}
          <ul className="divide-y">
            {filtered.map((p) => {
              const active = p.key === selectedKey;
              return (
                <li key={p.key}>
                  <button
                    type="button"
                    onClick={() => select(p)}
                    className={cn(
                      'w-full px-2.5 py-2 text-left transition-colors',
                      active ? 'bg-primary/5 ring-1 ring-inset ring-primary/20' : 'hover:bg-accent/60',
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="truncate text-[12px] font-medium">{p.label}</span>
                      {p.is_customized && (
                        <Badge variant="outline" className="h-4 px-1 text-[9px]">已改</Badge>
                      )}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{p.key}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex min-h-0 flex-col rounded-md border bg-card">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center p-6 text-[12px] text-muted-foreground">
              选择左侧一条提示词查看或编辑
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-2 border-b px-3 py-2">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold">{selected.label}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">{selected.key}</div>
                  {selected.description && (
                    <p className="mt-1 text-[11px] text-muted-foreground">{selected.description}</p>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <Badge variant="outline" className="text-[10px]">
                      {CATEGORY_LABEL[selected.category] || selected.category}
                    </Badge>
                    {selected.task_type && (
                      <Badge variant="outline" className="text-[10px]">task: {selected.task_type}</Badge>
                    )}
                    <Badge variant="outline" className="text-[10px]">v{selected.version}</Badge>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 text-[11px]"
                    disabled={!canEdit || resetMut.isPending}
                    onClick={() => resetMut.mutate()}
                  >
                    <RotateCcw className="h-3 w-3" />
                    重置
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 gap-1 text-[11px]"
                    disabled={!canEdit || !dirty || saveMut.isPending}
                    onClick={() => saveMut.mutate()}
                  >
                    {saveMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                    保存
                  </Button>
                </div>
              </div>
              <div className="flex min-h-0 flex-1 flex-col p-3">
                <Label className="mb-1.5 text-[11px]">Prompt 正文</Label>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  readOnly={!canEdit}
                  spellCheck={false}
                  className={cn(
                    'min-h-[280px] flex-1 resize-y rounded-md border bg-background p-2.5 font-mono text-[11.5px] leading-relaxed outline-none focus:ring-1 focus:ring-primary',
                    !canEdit && 'opacity-80',
                  )}
                />
                {!!selected.variables?.length && (
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    变量：{selected.variables.map((v) => `{${v}}`).join('、')}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
