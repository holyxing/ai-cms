// ImportCategoriesDialog.tsx - 栏目 Excel 批量导入 (P7+)
//
// 用法: <ImportCategoriesDialog open={open} onClose={...} siteId={siteId} onSuccess={...} />
// 流程: 选择 .xlsx → 预览前 5 行 → 上传 → 显示导入结果 (X 个栏目已导入)
// Excel 格式: 3 列 一级栏目/二级栏目/三级栏目 (按列名识别), 空单元格继承上一行
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast as sonnerToast } from 'sonner';
import { FileSpreadsheet, Upload, X, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { categoriesApi, type CategoryImportItem } from '@/api/categories';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
  siteId: string;
  onSuccess?: (result: { created: CategoryImportItem[]; total: number }) => void;
}

interface PreviewRow {
  level1: string;
  level2: string;
  level3: string;
}

function parsePreview(file: File): Promise<PreviewRow[]> {
  // 浏览器里没法真正解析 xlsx (没装 SheetJS), 用文件名 + 提示用户格式
  // 真解析走后端, 这里只展示文件元信息
  return Promise.resolve([]);
}

export function ImportCategoriesDialog({ open, onClose, siteId, onSuccess }: Props) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ created: CategoryImportItem[]; total: number } | null>(null);

  const importMut = useMutation({
    mutationFn: (f: File) => categoriesApi.importXlsx(siteId, f),
    onSuccess: (data) => {
      setResult(data);
      sonnerToast.success(`成功导入 ${data.total} 个栏目`);
      qc.invalidateQueries({ queryKey: ['category-tree', siteId] });
      onSuccess?.(data);
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.message || e?.message || '导入失败';
      sonnerToast.error(msg);
    },
  });

  if (!open) return null;

  const reset = () => {
    setFile(null);
    setResult(null);
    importMut.reset();
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFile = (f: File | null) => {
    if (!f) return;
    if (!f.name.match(/\.xlsx$/i)) {
      sonnerToast.error('仅支持 .xlsx 格式');
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      sonnerToast.error('文件不能超过 5MB');
      return;
    }
    setFile(f);
    setResult(null);
    void parsePreview(f);
  };

  const handleUpload = () => {
    if (!file) return;
    importMut.mutate(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={handleClose}>
      <div
        className="w-full max-w-lg rounded-lg border bg-background shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold">从 Excel 导入栏目</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              列: 一级栏目 / 二级栏目 / 三级栏目 · 空单元格继承上一行
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 主体 */}
        <div className="space-y-4 p-5">
          {/* 上传区 */}
          {!result && (
            <div>
              <label
                className={cn(
                  'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 transition-colors',
                  file ? 'border-primary/40 bg-primary/5' : 'border-border hover:border-primary/30 hover:bg-secondary/30',
                )}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleFile(e.dataTransfer.files?.[0] ?? null);
                }}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                />
                <FileSpreadsheet className={cn('h-8 w-8', file ? 'text-primary' : 'text-muted-foreground')} />
                {file ? (
                  <>
                    <div className="text-sm font-medium">{file.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {(file.size / 1024).toFixed(1)} KB · 点击重新选择
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-sm font-medium">点击或拖入 .xlsx 文件</div>
                    <div className="text-[11px] text-muted-foreground">最大 5 MB</div>
                  </>
                )}
              </label>
            </div>
          )}

          {/* 格式说明 */}
          {!result && !importMut.isPending && (
            <div className="rounded-md border bg-secondary/30 px-3 py-2 text-[11px] text-muted-foreground">
              <div className="font-medium text-foreground">Excel 格式示例:</div>
              <pre className="mt-1 font-mono text-[10px] leading-relaxed">{`一级栏目    二级栏目           三级栏目
产品中心    海石 AI 标签平台
            海山中台平台
            泰坦可信空间
产品解决方案  可信数据空间
            数据安全治理`}</pre>
              <div className="mt-1">空白的二级/三级单元格表示继承上一行的上一级</div>
            </div>
          )}

          {/* 上传中 */}
          {importMut.isPending && (
            <div className="flex items-center justify-center gap-2 rounded-md border bg-secondary/30 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              解析并创建栏目中…
            </div>
          )}

          {/* 错误 */}
          {importMut.isError && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <div>{(importMut.error as any)?.response?.data?.message || (importMut.error as any)?.message || '导入失败'}</div>
            </div>
          )}

          {/* 成功结果 */}
          {result && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                <div>
                  <strong>已导入 {result.total} 个栏目</strong>
                  <div className="mt-0.5 text-emerald-600/80">
                    一级 {result.created.filter((c) => c.level === 1).length} 个,
                    二级 {result.created.filter((c) => c.level === 2).length} 个,
                    三级 {result.created.filter((c) => c.level === 3).length} 个
                  </div>
                </div>
              </div>
              {/* 树状预览 (前 20 行) */}
              <div className="max-h-64 overflow-y-auto rounded-md border bg-background">
                <div className="border-b px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  导入的栏目 (前 20 个)
                </div>
                <ul className="divide-y">
                  {result.created.slice(0, 20).map((c) => (
                    <li key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-[12px]">
                      <span className="flex-shrink-0 text-muted-foreground">
                        {c.level === 1 ? '◆' : c.level === 2 ? '└' : '·'}
                      </span>
                      <span className="flex-1 truncate">{c.name}</span>
                      <code className="rounded bg-secondary/50 px-1 text-[10px] text-muted-foreground">
                        {c.slug}
                      </code>
                    </li>
                  ))}
                  {result.created.length > 20 && (
                    <li className="px-3 py-1.5 text-center text-[11px] text-muted-foreground">
                      还有 {result.created.length - 20} 个…
                    </li>
                  )}
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-end gap-2 border-t bg-secondary/20 px-5 py-3">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleClose}>
            {result ? '关闭' : '取消'}
          </Button>
          {!result && (
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={!file || importMut.isPending}
              onClick={handleUpload}
            >
              <Upload className="h-3.5 w-3.5" />
              上传并导入
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}