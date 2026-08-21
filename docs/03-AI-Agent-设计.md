# 03 - AI Agent 设计

> AI 抽象层 + 单 Agent 多任务 → 多 Agent 编排的演进路径

---

## 1. 设计目标

| 目标 | 说明 |
|---|---|
| **统一接口** | OpenAI / Anthropic / Ollama 一个抽象，下游无感 |
| **任务路由** | 不同任务用不同 provider/model，可配置 |
| **降级** | provider 挂了自动 fallback |
| **可观测** | 每次 AI 调用都有记录（tokens/耗时/成本） |
| **流式优先** | 编辑器里的 AI 交互必须流式 |
| **可控** | AI 不能改 schema/源码，只能改"业务数据" |

---

## 2. 抽象层（`backend/app/agents/`）

```
agents/
├── base.py                 # AIProvider Protocol, Message, AIResponse
├── router.py               # AIRouter（按 task 路由）
├── orchestrator.py         # 多 Agent 编排（V2）
├── providers/
│   ├── openai.py
│   ├── anthropic.py
│   ├── ollama.py
│   └── litellm.py          # 兜底（用 litellm 包覆盖 100+ provider）
├── tasks/                  # 任务定义
│   ├── write_article.py
│   ├── rewrite.py
│   ├── translate.py
│   ├── continue_text.py
│   ├── summarize.py
│   ├── seo_audit.py
│   ├── accessibility_audit.py
│   ├── design_suggest.py
│   ├── categorize.py
│   └── generate_alt.py
└── prompts/                # 所有 prompt 模板
    ├── write_article.yaml
    ├── rewrite.yaml
    └── ...
```

### 2.1 base.py 核心类型

```python
from typing import Protocol, AsyncIterator
from pydantic import BaseModel

class Message(BaseModel):
    role: str  # "system" | "user" | "assistant" | "tool"
    content: str

class AIUsage(BaseModel):
    tokens_in: int
    tokens_out: int
    cost_usd: float = 0.0

class AIResponse(BaseModel):
    content: str
    usage: AIUsage
    model: str
    raw: dict | None = None

class AIProvider(Protocol):
    name: str
    async def chat(
        self,
        messages: list[Message],
        model: str,
        *,
        temperature: float = 0.7,
        max_tokens: int | None = None,
        response_format: dict | None = None,
        **kwargs,
    ) -> AIResponse: ...

    async def stream_chat(
        self, messages: list[Message], model: str, **kwargs
    ) -> AsyncIterator[str]: ...
```

### 2.2 router.py

```python
class TaskType(str, Enum):
    WRITE_ARTICLE = "write_article"
    REWRITE = "rewrite"
    TRANSLATE = "translate"
    DESIGN_SUGGEST = "design_suggest"
    SEO_AUDIT = "seo_audit"
    # ...

class AIRouter:
    """根据任务类型 + 站点配置选 provider/model"""

    def __init__(self, db: AsyncSession, site_id: UUID):
        self.db = db
        self.site_id = site_id

    async def get_provider(self, task: TaskType) -> tuple[AIProvider, str]:
        # 1. 查 site_settings.ai_overrides
        # 2. 查全局 ai_providers 表的 default_for_task
        # 3. 兜底：第一个可用的 provider
        # 4. fallback chain 排好
        ...

    async def chat(self, task: TaskType, messages: list[Message], **opts) -> AIResponse:
        providers = await self.get_fallback_chain(task)
        for provider, model in providers:
            try:
                return await provider.chat(messages, model, **opts)
            except AIError as e:
                log_warning(f"provider {provider.name} failed: {e}")
                continue
        raise AllProvidersFailedError(...)
```

---

## 3. 任务设计（每个 AI 能力 = 一个 Task）

### 3.1 Task 接口

```python
class AITask(Protocol):
    name: TaskType
    description: str

    def build_messages(self, input: dict, context: dict) -> list[Message]:
        """根据输入 + 上下文构建 prompt"""
        ...

    def parse_output(self, raw: str) -> dict:
        """把模型输出解析为业务数据"""
        ...

    def post_process(self, output: dict, context: dict) -> dict:
        """后处理（校验、丰富字段）"""
        ...
```

### 3.2 示例：write_article

```python
# agents/tasks/write_article.py

WRITE_ARTICLE_PROMPT = """你是一位专业的中文内容编辑。
为站点「{site_name}」（定位：{site_description}）写一篇文章。

主题：{topic}
目标读者：{audience}
语气：{tone}  # 专业/轻松/营销/学术
长度：{length}  # 短(<500字)/中(500-1500)/长(>1500)
关键词：{keywords}

要求：
1. 标题吸引人，含关键词
2. 段落清晰，每段一个核心观点
3. 适当使用小标题、列表、引用
4. SEO 友好：标题层级正确（H2/H3），关键段落有总结

输出严格的 JSON 格式：
{{
  "title": "...",
  "summary": "...",
  "blocks": <Tiptap JSON>,
  "tags": ["...", "..."],
  "seo": {{"title": "...", "description": "...", "keywords": ["..."]}}
}}
"""

class WriteArticleTask:
    name = TaskType.WRITE_ARTICLE

    async def execute(self, input: dict, context: dict, router: AIRouter) -> dict:
        messages = [
            Message(role="system", content="你是专业的中文内容编辑。"),
            Message(role="user", content=WRITE_ARTICLE_PROMPT.format(**input, **context)),
        ]
        # 让模型强制 JSON 输出
        response = await router.chat(
            self.name, messages, response_format={"type": "json_object"}
        )
        return self.parse_output(response.content)
```

### 3.3 设计建议任务（核心差异化）

```python
# agents/tasks/design_suggest.py

DESIGN_SUGGEST_PROMPT = """你是 UI 设计师。用户想调整站点样式。
当前设计 tokens：
{current_tokens}

用户需求：
{user_request}

参考风格（可选）：
{reference_style}

输出严格的 JSON，给出修改方案：
{{
  "rationale": "为什么这么改",
  "diff": [
    {{"path": "color.primary", "old": "#3b82f6", "new": "#06b6d4", "reason": "更年轻"}},
    ...
  ],
  "preview_description": "改完后视觉上会是什么样"
}}

约束：
1. 只能改 tokens，不能加新字段
2. 颜色对比度要满足 WCAG AA
3. 保持整体协调，不要每个 token 都改
"""
```

**安全机制**：AI 输出是**建议**，必须经用户确认才写回 `current_theme.tokens`；可回滚。

---

## 4. 提示词管理

### 4.1 文件化

```
prompts/
├── write_article.yaml
├── rewrite.yaml
└── ...
```

```yaml
# prompts/write_article.yaml
name: write_article
version: 1
system: |
  你是专业的中文内容编辑。
  你的输出必须是严格合法的 JSON。
user_template: |
  为站点「{site_name}」写一篇文章...
variables:
  - site_name
  - topic
  - tone
  - length
  - audience
  - keywords
output_format: json
```

**好处**：
- 业务人员也能改
- 可做 A/B（同一任务多个 prompt 模板）
- 可国际化

### 4.2 Prompt 版本管理

- `ai_jobs` 表里记 `prompt_version`
- 改 prompt 写新版本，不破坏历史

---

## 5. 上下文注入策略

不同任务需要不同上下文：

| 任务 | 需要的上下文 |
|---|---|
| 写文章 | 站点名/描述/调性 + 历史文章标题（避免重复） |
| 改样式 | 当前 tokens + 可选参考图 |
| SEO 审计 | 完整内容 blocks + 站点 meta |
| 自动分类 | 文章标题/摘要 + 现有分类树 |
| 配图 | 内容描述 + 已有图库（避免重复） |

**实现**：`ContextBuilder` 按任务类型聚合上下文，可缓存。

---

## 6. 多 Agent 编排（V2）

### 6.1 单 Agent 多任务（MVP）

```
用户: "写一篇关于 AI 在内容管理中应用的文章"
     ↓
Router → WriteArticleTask
     ↓
流式返回 Tiptap JSON
     ↓
前端填充到编辑器
```

### 6.2 多 Agent 协作（V2 - "一篇文章" Agent Team）

```
用户: "我要发一篇关于 AI 内容管理的文章"
                ↓
        [Orchestrator]
                ↓
        ┌───────┴───────┐
        ▼               ▼
   [策划 Agent]    [研究 Agent]
   - 拟定提纲       - 拉取素材
        ↓               ↓
        └───────┬───────┘
                ▼
        [写作 Agent]
        - 起草
                ↓
        [审校 Agent]
        - SEO 审计
        - 可读性
        - 敏感词
                ↓
        [配图 Agent]
        - 生成/选图
                ↓
            用户确认
```

**实现**：
- 用 LangGraph 编排（图状态机）
- 用 Celery 跑长任务
- 用户可在 Agent 之间打断、修改

### 6.3 站点级 Agent（V2 - "我的站点健康吗"）

```
定时任务：每周跑一次
     ↓
[健康 Agent]
  ├── SEO 扫描（每篇文章）
  ├── 死链检测
  ├── 图片 alt 覆盖率
  ├── 内容质量（重复/过短/标题党）
  ├── 可访问性
  └── 性能（生成站点后跑 Lighthouse）
     ↓
聚合报告 → 推送给站点管理员
     ↓
管理员点"一键修复" → 各 Agent 出修复建议 → 用户确认 → 执行
```

---

## 7. 成本与限流

| 策略 | 实现 |
|---|---|
| **Token 预算** | 站点级月预算，超了限速或停用 |
| **限流** | 按用户/IP/站点限 QPS |
| **缓存** | 相同 input + 相同 prompt version → 命中缓存（短 TTL） |
| **降级** | 长任务用 mini 模型（如 gpt-4o-mini / qwen2.5-7b） |
| **成本可见** | 每次调用记到 `ai_jobs`，后台有"AI 成本"页 |

---

## 8. 安全与可控

- **AI 不直接写库**：AI 输出 → 落到 `ai_suggestions`（待采纳）→ 用户点"应用" → 才写正式表
- **结构化输出**：用 JSON mode / Tool Use，禁止 AI 自由发挥 HTML
- **敏感词**：审校 Agent 必跑（合规）
- **Prompt 注入防护**：用户输入要转义/隔离（不要让用户的"主题"覆盖 system prompt）
- **审计**：所有 AI 任务进 `ai_jobs`，可追溯

---

## 9. 验收（MVP）

- [ ] OpenAI provider 跑通
- [ ] Ollama provider 跑通（本地 qwen2.5）
- [ ] 5 个 task：write_article / rewrite / translate / design_suggest / seo_audit
- [ ] 流式响应前端能正确显示
- [ ] 降级 chain 跑通（OpenAI 挂 → 切 Ollama）
- [ ] 每次调用有记录
- [ ] Prompt 文件化

---

## 10. 选型确认

- **抽象库**：`litellm`（统一 100+ provider，省事）
- **Agent 编排**（V2）：LangGraph
- **本地模型**：Ollama（默认 qwen2.5:7b / bge-m3）
