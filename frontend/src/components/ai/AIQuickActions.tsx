/**
 * AIQuickActions.tsx - AI 助手弹窗内的任务卡片网格 (P3.10)
 *
 * 渲染:
 * - article mode → 10 张文章任务卡 (send extraInput)
 * - template mode → 6 张模板任务卡 (send extraInput)
 * - general mode → 3 张站点快捷卡 (P3.10.3: 弹 modal 不走 AI, 一次点完事)
 *
 * P3.10.3 (holy 反馈 #13169): 之前 general 模式走 site_agent 多轮反问体验很啰嗦
 * 修法: 站点快捷卡 siteAction 字段 → 调对应 modal (CreateSiteModal / EditSiteModal / ConfirmPublishModal)
 * 多轮 site_agent 路径仍可走底部输入框 (用户主动用)
 *
 * P3.10.4 (holy 反馈 #13214): theme 任务需要 user 填 instruction → requiresInput 走 setPendingTask
 * P3.10.5 (holy 反馈 #13287/91): import_docx/pdf 需文件上传 → fileAccept 弹文件选择器
 * P3.10.10 (holy 反馈 #13498 "AI 助手图标不够专业和幸福, 太素了"): 任务卡 icon 加 4 桶色轻底 (按 mode 分), 跟 dashboard 数字行 + sites 字母图标风格一致
 *   - article=blue / template=purple / general=slate
 *   - 轻底 5x5 圆角 + icon 11x11, 不抢戏但有锐点
 */
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { getActionsForMode, type QuickAction } from '@/config/aiTasks';
import { useAIAssistant } from '@/stores/aiAssistant';
import { sitesApi, type Site } from '@/api/sites';
import { mediaApi } from '@/api/media';
import { toast } from 'sonner';
import {
  CreateSiteModal,
  EditSiteModal,
  ConfirmPublishModal,
} from './AISiteModals';

export const AIQuickActions: React.FC = () => {
  const mode = useAIAssistant((s) => s.mode);
  const isRunning = useAIAssistant((s) => s.isRunning);
  const send = useAIAssistant((s) => s.send);
  const setPendingTask = useAIAssistant((s) => s.setPendingTask);
  const context = useAIAssistant((s) => s.context);

  // P3.10.3: site action modal 状态 (general mode 专用)
  const [action, setAction] = React.useState<'create_site' | 'edit_site' | 'publish_site' | null>(null);

  // 当前站点: 优先用 context.target.siteId (dashboard 注入过)
  const currentSiteId = context?.target?.siteId;
  const siteQ = useQuery({
    queryKey: ['ai-quickactions-site', currentSiteId],
    queryFn: () => sitesApi.get(currentSiteId!),
    enabled: !!currentSiteId,
    staleTime: 30_000,
  });
  const currentSite: Site | null = siteQ.data ?? null;

  // P3.10.5 (holy 反馈 #13287/91): 文件上传状态 (import_docx / import_pdf)
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [pendingFileAction, setPendingFileAction] = React.useState<QuickAction | null>(null);
  const [uploading, setUploading] = React.useState(false);

  // 处理文件上传 (P3.10.5)
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const act = pendingFileAction;
    setPendingFileAction(null);
    if (!file || !act) return;
    // 取 siteId: 优先用 currentSiteId, fallback 拉第一个 site
    let siteId = currentSiteId;
    if (!siteId) {
      try {
        const r = await sitesApi.list({ page: 1, page_size: 1 });
        siteId = r.items?.[0]?.id;
      } catch {
        toast.error('无法识别当前站点');
        return;
      }
    }
    if (!siteId) {
      toast.error('无法识别当前站点');
      return;
    }
    setUploading(true);
    try {
      const r = await mediaApi.upload(siteId, file);
      // r 是 AxiosResponse<APIResponse<MediaItem>> → r.data.data.file_url
      const fileUrl = r.data?.data?.file_url;
      if (!fileUrl) {
        toast.error('上传成功但未拿到 file_url');
        return;
      }
      toast.success(`文件已上传: ${file.name}`);
      // 发 import 任务, file_url 走 extraInput
      send('', act.type, { file_url: fileUrl });
    } catch (err: any) {
      toast.error(err?.response?.data?.message || '文件上传失败');
    } finally {
      setUploading(false);
    }
  };

  // 处理任务卡点击 (统一入口)
  const handleActionClick = (a: QuickAction) => {
    if (a.requiresInput) {
      setPendingTask(a.type);
      return;
    }
    if (a.fileAccept) {
      setPendingFileAction(a);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
        fileInputRef.current.click();
      }
      return;
    }
    send('', a.type, a.extraInput);
  };

  // 通用卡片 grid (article / template 模式)
  const renderGrid = (cards: (a: QuickAction, i: number) => React.ReactNode) => (
    <div className="grid grid-cols-1 gap-1 md:grid-cols-2 xl:grid-cols-3">
      {actions.map(cards)}
    </div>
  );

  const actions = React.useMemo(() => getActionsForMode(mode), [mode]);

  // 隐藏文件 input (P3.10.5)
  const hiddenFileInput = (
    <input
      ref={fileInputRef}
      type="file"
      className="hidden"
      accept={pendingFileAction?.fileAccept}
      onChange={handleFileChange}
    />
  );

  if (mode === 'general' && actions.length > 0) {
    // general mode 3 个站点卡: 走 modal 不走 AI
    return (
      <>
        {renderGrid((a, i) => (
          <ActionCard
            key={`${a.type}-${a.label}-${i}`}
            action={a}
            disabled={isRunning}
            mode={mode}
            onClick={() => {
              if (a.siteAction) {
                if ((a.siteAction === 'edit_site' || a.siteAction === 'publish_site') && !currentSiteId) {
                  useAIAssistant.getState().close();
                  window.location.assign('/admin/sites');
                  return;
                }
                setAction(a.siteAction);
              } else {
                handleActionClick(a);
              }
            }}
          />
        ))}
        {action === 'create_site' && <CreateSiteModal open onClose={() => setAction(null)} />}
        {action === 'edit_site' && currentSite && <EditSiteModal open onClose={() => setAction(null)} site={currentSite} />}
        {action === 'publish_site' && currentSite && <ConfirmPublishModal open onClose={() => setAction(null)} site={currentSite} />}
        {hiddenFileInput}
      </>
    );
  }

  if (actions.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-secondary/20 px-3 py-4 text-center text-[11px] text-muted-foreground">
        通用对话模式: 在下方输入框直接提问即可
      </div>
    );
  }

  return (
    <>
      {renderGrid((a, i) => (
        <ActionCard
          key={`${a.type}-${a.label}-${i}`}
          action={a}
          disabled={isRunning || uploading}
          mode={mode}
          onClick={() => handleActionClick(a)}
        />
      ))}
      {hiddenFileInput}
    </>
  );
};

const ActionCard: React.FC<{ action: QuickAction; disabled: boolean; onClick: () => void; mode?: string }> = ({
  action, disabled, onClick, mode,
}) => {
  const Icon = action.icon;
  // P3.10.10 (holy 反馈 #13498): 任务卡 icon 加 轻底色 + 主色 (按 mode 分桶, 跟 mode 切换器 + dashboard 数字行 + sites 字母图标 4 桶色一致)
  //  - article=blue / template=purple / general=slate
  //  - 轻底 (h-5 w-5 圆角 6px) + icon 11x11 缩一点, 不抢戏但有锐点
  const accentClass =
    mode === 'template'
      ? 'bg-purple-50 text-purple-600 group-hover:bg-purple-100'
      : mode === 'article'
      ? 'bg-blue-50 text-blue-600 group-hover:bg-blue-100'
      : 'bg-secondary text-muted-foreground group-hover:bg-secondary/80';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'group flex items-start gap-2 rounded-md border bg-card px-2.5 py-2 text-left transition-colors',
        'hover:border-primary hover:bg-secondary/30',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
      title={action.desc}
    >
      <span
        className={cn(
          'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded transition-colors',
          accentClass,
        )}
      >
        <Icon className="h-3 w-3" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="truncate text-[12px] font-medium leading-tight text-foreground">{action.label}</div>
        <div className="text-[10.5px] leading-snug text-muted-foreground line-clamp-1">{action.desc}</div>
      </div>
    </button>
  );
};
