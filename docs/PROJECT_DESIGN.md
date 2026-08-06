# AI Agent 服务器运维工具 — 项目设计方案

> 一个基于 AI Agent + MCP 协议的桌面端服务器运维工具。
> 参考:Solsynth/MaidKit(Flutter)、Cline(VS Code)、Claude Desktop。
> 编写日期:2026-08-05

---

## 一、定位与目标

**一句话**:让运维工程师用自然语言指挥 AI Agent,通过 SSH + MCP 工具安全地管理服务器、容器、部署。

**核心特征**
- 桌面优先(Windows / macOS / Linux),移动端不在 v1 范围
- 非侵入式:目标服务器零安装,全部走 SSH
- AI Agent 是一等公民:不只是聊天,能实际执行运维动作
- 安全第一:高危操作强制 human-in-the-loop,凭证加密存储

---

## 二、技术选型(已锁定)

| 层 | 选型 | 理由 |
|---|---|---|
| **桌面框架** | **Tauri 2** | 体积小(~10MB)、内存低、Rust 后端契合运维场景 |
| **前端** | **React + TypeScript** | 生态最丰富,与 Cline/Claude Desktop 同款,抄作业路径清晰 |
| **UI 组件** | shadcn/ui + Tailwind | 现代美观、可定制、无需写 CSS |
| **终端** | **xterm.js** | 业界事实标准,VS Code 同款,GPU 加速,vim/tmux/IME 全支持 |
| **SSH** | Rust 后端用 **`russh`** | 纯 Rust 异步 SSH,性能好、内存安全 |
| **MCP Client SDK** | **`@modelcontextprotocol/sdk`(TypeScript,Tier 1 官方)** | 跟进协议最快,被所有主流 Host 验证 |
| **MCP Server(暴露自身能力)** | Rust `rmcp` 或 TS SDK | 让外部 Agent 也能连进来操作你的 SSH 能力 |
| **本地数据库** | **SQLite + Drizzle ORM(TS 侧)** | 轻量、零配置,Drizzle 类型安全且迁移简单 |
| **加密** | Rust 侧 `ring` / `aes-gcm`;密钥进 OS keychain | AES-GCM-256,PBKDF2 高迭代次数 |
| **LLM 调用** | 直接 `fetch` 走 OpenAI 兼容流式 API | 绕过 SDK,保留 reasoning_content 等扩展字段 |
| **图表/日志** | Recharts / 轻量日志组件 | 服务器监控仪表盘 |

**为什么不选 Flutter(即便 MaidKit 用它)**:
1. MCP 官方 Dart 包仍实验性,MaidKit 被迫自己用纯 Dart 重写了整套 MCP 客户端/服务端 —— 这是巨大的重复造轮子,我们没必要重走。
2. xterm.js 的终端成熟度远超 xterm.dart,运维工具的终端是灵魂。
3. 桌面场景下 Tauri 的体积/内存优势明显,且官方 MCP TS SDK 是 Tier 1。
4. Web 生态的图表/Markdown/Monaco 编辑器等组件可直接复用。

---

## 三、整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Tauri 主进程(Rust)                       │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ SSH 引擎    │  │ 凭证保险库  │  │ 本地 MCP Server     │ │
│  │ (russh)     │  │ (ring/AES)  │  │ (暴露 SSH 能力,     │ │
│  │             │  │ keychain    │  │  HTTP+SSE, loopback)│ │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
│         │                │                    │            │
│         │   ┌────────────┴────────┐           │            │
│         │   │  Tauri IPC Commands │           │            │
│         │   │  (前端 ↔ Rust 桥)   │           │            │
│         ▼   └─────────────────────▼           ▼            │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────┴───────────────────────────────────┐
│                   前端 WebView (React)                       │
│                                                             │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ Agent    │  │ MCP Client   │  │ UI 层                  │ │
│  │ Loop     │  │ (@mcprotocol │  │ - 服务器仪表盘         │ │
│  │ (流式对话│  │  /sdk)       │  │ - xterm.js 终端        │ │
│  │  +工具调用│  │ - stdio 子进程│ │ - SFTP 双栏文件管理    │ │
│  │  +审批)  │  │ - HTTP 远程  │  │ - Agent 聊天 + 审批卡  │ │
│  └────┬─────┘  └──────┬───────┘  │ - 容器/Compose 管理    │ │
│       │               │          └────────────────────────┘ │
│       └───────┬───────┘                                   │
│               │ 工具池聚合                                  │
│               ▼                                            │
│        统一暴露给 LLM(内置工具 + MCP 工具)                 │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼ (流式)
                   ┌──────────────┐
                   │ LLM Provider │  OpenAI / DeepSeek / 本地
                   │ (兼容 API)   │  保留 reasoning_content
                   └──────────────┘
```

### 两条 MCP 数据流(借鉴 MaidKit 的双向设计)

1. **作为 MCP Client**(调外部工具):前端 TS SDK 为每个配置的 server spawn 一个 stdio 子进程(本地)或建 HTTP 连接(远程),聚合工具池喂给 Agent。
2. **作为 MCP Server**(暴露自身能力):Rust 侧起一个 loopback HTTP+SSE server(默认端口 8746),让外部 Agent(如 Claude Desktop、Cline)也能连进来,通过你的 App 操作 SSH 服务器 —— 这样你的 App 本身就变成了一个可被复用的运维工具。

---

## 四、关键模块设计

### 4.1 Agent 工作流(核心,借鉴 MaidKit 的 Proposal/Execution 解耦)

这是整个应用最关键的设计。**绝不让 LLM 直接执行命令**,流程严格分三阶段:

```
用户输入
   │
   ▼
┌──────────────┐
│ 1. 流式对话   │  fetch → OpenAI 兼容 API
│   _streamChat │  自己解析流式分片,累积 tool_calls
└──────┬───────┘  保留 reasoning_content 回传
       │ 模型输出 tool_calls
       ▼
┌──────────────┐
│ 2. 生成提案   │  Proposal = {工具名, 参数, safeToRun}
│   (Proposal) │  ❌ 此时绝不执行
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 3. 审批门     │  根据 RunPolicy 决定:
│  (审批 UI)   │  - always_ask:弹卡片等用户点
│               │  - auto_review:只读操作自动过,危险操作弹窗
│               │  - always_approve:全自动(慎用)
└──────┬───────┘
       │ 用户批准
       ▼
┌──────────────┐
│ 4. 执行       │  传入已建立的 SSHClient
│  execute()   │  注册 CancelToken(用户中止→关 SSH 会话)
└──────┬───────┘  输出截断到 12000 字符防 token 爆炸
       │
       ▼
┌──────────────┐
│ 5. 续轮      │  把结果以 tool 角色消息追加进历史
│   continue() │  LLM 再分析 → 可能再提案,循环直到完成
└──────────────┘
```

**关键原则**
- `safeToRun` 标记:工具 schema 里注入布尔字段,模型标记是否只读/安全
- 内置工具:`run_command`、`read_file`、`write_file`、`list_containers` 等
- MCP 工具命名空间化:`mcp_<serverId>__<toolName>`,防冲突
- **审批策略双轨制**:App 内聊天 Agent 的策略 和 外部 MCP 接入的策略 是两套独立配置(用户可能想让外部连进来的更严格)
- **改审批策略本身永远不自动批准**(防止误开 always_approve)

### 4.2 内置工具集(暴露给 LLM)

| 工具 | 说明 | safeToRun 默认 |
|---|---|---|
| `run_command` | 执行 shell 命令 | ❌ 危险 |
| `read_file` / `write_file` / `delete_file` | SFTP 文件操作 | write/delete ❌ |
| `list_containers` / `control_container` | Docker/Podman | list ✅,control ❌ |
| `get_service_status` / `manage_service` | systemd | get ✅,manage ❌ |
| `get_metrics` | CPU/内存/网络快照 | ✅ |
| `run_snippet` | 执行预置脚本 | ❌ |
| `get_skill` | 按需加载运维知识包(markdown) | ✅ |

### 4.3 凭证保险库(借鉴 MaidKit 的分层加密)

```
用户主密码
    │ PBKDF2 (310000 次迭代, 16字节 salt)
    ▼
Vault Key (派生密钥)
    │ 用它加密所有敏感数据(AES-GCM-256)
    ▼
┌─────────────────────────────────┐
│ SSH 密码 / 私钥                 │──→ AES-GCM 密文存 SQLite
│ API Key (LLM Provider)          │──→ AES-GCM 密文存 SQLite
│ 代理密码                        │──→ AES-GCM 密文存 SQLite
│ MCP server 的 env (可能含密钥)  │──→ AES-GCM 密文存 SQLite
└─────────────────────────────────┘

Vault Key 本身怎么存?
   → 用 OS keychain (macOS Keychain / Windows Credential Manager / Linux Secret Service) 包一层
   → 生物识别解锁 (TouchID / Windows Hello)
```

**关键边界**(直接抄 MaidKit 的安全决策):
- 凭证、API key、代理密码 → 加密存,绝不进明文表
- **Agent 对话历史 → 只存本地文件,绝不进 vault,不云同步**(隐私)
- 待审批的 Proposal → **不持久化**,重启即丢失(安全)

### 4.4 MCP 集成(双向)

**作为 Client**(主场景):
- 配置导入:**兼容三种格式** —— VS Code `mcp.json`(`servers`)、Cline(`servers`)、Claude Desktop(`mcpServers`)。容错导入:逐条解析,部分失败不影响其他。
- 传输:本地 stdio(`Process.spawn` 子进程)、远程 HTTP(Streamable HTTP + OAuth)
- 生命周期管理:每个 server 一个 client 实例,启动失败有冷却(30s)避免反复崩溃
- 工具发现:`tools/list` + 订阅 `toolsListChanged` 热更新

**作为 Server**(进阶,让外部 Agent 复用你的 App):
- 绑定 loopback IPv4(只接受本机连接)
- HTTP+SSE:`GET /sse` 建立会话,`POST /message` 收 JSON-RPC
- 暴露工具:`run_command`、`read_file`、`write_file`
- **独立的审批策略**(McpReviewMode),与 App 内 Agent 分开

### 4.5 SSH 终端(xterm.js)

- 前端 xterm.js 渲染 + 插件(fit、webgl、搜索)
- 输入 → IPC → Rust 后端 russh session → 远程
- 输出流 ← IPC ← Rust ← russh
- 多标签、分屏、复制粘贴、主题

### 4.6 数据库设计(SQLite)

集中式 schema(借鉴 MaidKit 单 AppDatabase 思路),核心表:

```
servers            -- 主机/端口/用户、加密凭证列、host key 指纹、可选代理
saved_credentials  -- 可复用的加密 SSH 凭证
vault_metadata     -- salt、wrapped key、verifier
mcp_servers        -- MCP server 配置(command/args/env 存 JSON 避免迁移)
agent_providers    -- LLM provider 档案(API key 加密)
agent_conversations-- 会话元信息(实际内容存 JSONL 文件)
agent_skills       -- 运维知识包(markdown,无凭证)
snippets           -- 可复用 shell 脚本
deployment_projects-- 部署项目(config 存 JSON)
```

**可变子结构一律存 JSON 列**(args、env、resource config)—— 避免频繁 schema 迁移,这是 MaidKit 验证过的实用策略。

---

## 五、项目结构(Tauri 工程)

```
ai-ops/
├── src-tauri/                  # Rust 后端
│   ├── src/
│   │   ├── main.rs
│   │   ├── ssh/                # russh 连接管理、会话池
│   │   ├── vault/              # 加密、keychain 集成
│   │   ├── mcp_server/         # 本地 MCP server (HTTP+SSE)
│   │   ├── commands/           # Tauri IPC commands
│   │   └── db/                 # SQLite 连接、迁移
│   └── Cargo.toml
├── src/                        # React 前端
│   ├── agent/                  # Agent loop、工具定义、审批、会话
│   │   ├── agent-service.ts    # 核心:流式对话 + Proposal 生成
│   │   ├── tools/              # 内置工具实现(调 IPC,含 get_skill 等)
│   │   ├── mcp-client.ts       # MCP 客户端(@modelcontextprotocol/sdk)
│   │   ├── mcp-config-parser.ts
│   │   ├── approval.ts         # 审批策略、Proposal 类型
│   │   ├── cancel-token.ts     # 跨 SSH/MCP 的取消机制
│   │   ├── conversation-store.ts  # JSONL 本地存储
│   │   └── doc-generator.ts    # 需求3:从审计日志+会话生成复盘文档
│   ├── audit/                  # 需求1:操作审计日志 UI(筛选/搜索/会话聚合)
│   ├── skills/                 # 需求2:SOP 技能包 + 快捷指令管理
│   │   ├── skill-editor.tsx    # 技能包编辑器(markdown)
│   │   ├── quick-action-runner.tsx  # 快捷指令执行器
│   │   └── command-palette.tsx # Cmd+K 命令面板
│   ├── docs/                   # 需求3:文档沉淀 UI(列表/查看/转技能)
│   ├── servers/                # 服务器管理 UI + 逻辑
│   ├── terminal/               # xterm.js 封装
│   ├── sftp/                   # 双栏文件管理
│   ├── containers/             # Docker/Podman 管理
│   ├── vault/                  # 凭证库 UI
│   ├── components/ui/          # shadcn 组件
│   ├── lib/                    # IPC 封装、工具函数
│   ├── routes/                 # 页面路由
│   └── App.tsx
├── package.json
└── tauri.conf.json
```

**目录原则**(借鉴 MaidKit AGENTS.md):扁平 feature 结构,`src/<feature>/`,**不要硬套 Clean Architecture 的 domain/data/presentation 分层**,除非某个 feature 真的大到需要。

---

## 六、运维知识闭环:审计 / Skills / 文档沉淀

> 这是本项目区别于普通 SSH 工具的核心价值链:
> **Agent 干活 → 全程留痕 → 沉淀经验 → 经验反哺 Agent**。
> 三个需求是一条闭环,不是孤立功能。

```
        ┌─────────────────────────────────────────┐
        │            Agent 执行运维任务             │
        │   (跑命令 / 改文件 / 重启服务 / 排障)    │
        └──────────────┬──────────────────────────┘
                       │ 全程自动记录
                       ▼
        ┌──────────────────────────┐
        │  ① 操作审计日志 (Audit)   │  ← 需求1
        │  谁/何时/哪台/命令/结果   │
        └──────────────┬───────────┘
                       │ 任务完成后
                       ▼
        ┌──────────────────────────┐
        │  ③ 文档沉淀 (Docs)        │  ← 需求3
        │  复盘报告 / 变更记录 / SOP │
        └──────────────┬───────────┘
                       │ 用户审核 / 一键转技能
                       ▼
        ┌──────────────────────────┐
        │  ② Skills 知识库          │  ← 需求2
        │  SOP 技能包 + 快捷指令    │
        └──────────────┬───────────┘
                       │ 下次 Agent 遇到同类问题
                       ▼ get_skill
                  回到顶部(反哺)
```

### 6.1 需求一:操作审计日志(Audit Log)

**目标**:Agent 在服务器上执行的每一次操作,都留下不可篡改、可追溯的记录。

**记录什么(每条记录)**

| 字段 | 说明 | 示例 |
|---|---|---|
| `id` | 自增主键 | |
| `timestamp` | 精确到毫秒 | `2026-08-05 14:23:11.342` |
| `server_id` | 目标服务器 | `prod-web-01` |
| `server_host` | 冗余存 host,防服务器删除后失真 | `10.0.1.5` |
| `session_id` | 属于哪次 Agent 会话 | `sess_a1b2c3` |
| `source` | 操作来源 | `agent` / `manual_terminal` / `quick_action` / `mcp_external` |
| `tool_name` | 工具/命令名 | `run_command` / `write_file` |
| `command` | 实际命令或操作内容 | `systemctl restart nginx` |
| `args` | 参数(JSON) | `{path: "/etc/nginx/nginx.conf"}` |
| `exit_code` | 退出码 | `0` |
| `output` | 输出(截断,默认前 2000 字符) | |
| `success` | 成败 | `true` |
| `approved_by` | 审批人 / 策略 | `user:zhang` / `policy:auto_review` |
| `proposal_id` | 关联的提案 ID | |
| `duration_ms` | 耗时 | `340` |

**存储与查询**
- 存 SQLite `audit_logs` 表(`created_at` 建索引)
- UI 提供:按服务器/时间/来源/成败筛选;按命令内容全文搜索;按会话聚合查看一次完整的运维过程
- **审计日志独立于会话历史**:会话可删,审计日志默认不可删(可设保留策略,如 90 天)

**怎么自动写入(关键设计)**
- 在 Rust 侧 SSH 命令执行的统一出口写日志,**不管来源是 Agent / 手动终端 / 快捷指令 / 外部 MCP,都走同一个 `execute_and_audit()` 函数**,保证无遗漏
- 这就是「唯一出口」模式:所有命令执行必经此函数,审计天然完整

### 6.2 需求二:Skills(知识包 + 快捷指令,两类)

#### A. 运维 SOP 技能包(给 AI 看)

**形态**:Markdown 文档,带 frontmatter 元数据。

```markdown
---
id: nginx-502-troubleshoot
title: Nginx 502 排查 SOP
tags: [nginx, web, troubleshooting]
triggers: ["502", "bad gateway", "nginx 错误"]
applies_to: ["nginx"]           # 关联的服务器角色/标签
risk_level: low                 # low / medium / high
version: 1.2
updated_at: 2026-08-05
---

# Nginx 502 排查

## 现象
浏览器返回 502 Bad Gateway。

## 排查步骤
1. 检查上游服务是否存活:`systemctl status <upstream>`
2. 检查 nginx error log:`tail -100 /var/log/nginx/error.log`
3. 检查上游端口:`curl -I http://127.0.0.1:<port>/health`

## 常见根因
- 上游服务崩溃 → 重启
- 端口不对 → 检查 upstream 配置
- ...
```

**Agent 怎么用(借鉴 MaidKit 的 `get_skill` 机制)**
- 系统提示里只注入「已启用的技能标题列表 + triggers」(省 token)
- Agent 判断需要时,调用 `get_skill(id)` 工具按需拉取完整内容
- 技能内容进上下文后,Agent 按步骤执行
- **可手动启用/禁用**每个技能,避免上下文过载

#### B. 快捷指令(给人类一键点)

**形态**:预设的操作序列,UI 上是按钮/命令面板项。

```jsonc
// 一个快捷指令的定义
{
  "id": "restart-prod-nginx",
  "name": "重启生产 nginx",
  "icon": "rotate-cw",
  "target": { "type": "server", "id": "prod-web-01" },  // 或 server_group
  "steps": [
    { "type": "command", "value": "systemctl status nginx", "capture": "status" },
    { "type": "command", "value": "nginx -t", "guard": "{{status.exit_code}} === 0" },
    { "type": "command", "value": "systemctl reload nginx", "confirm": true }
  ],
  "approval": "always_ask",           // 高危必确认
  "audit": true                       // 自动写审计日志
}
```

**特性**
- **多步骤序列**:可串联命令、带条件 guard、引用上一步输出
- **目标可选**:单台服务器 / 服务器组(批量执行)
- **高危确认**:`confirm: true` 的步骤执行前弹确认框
- **快捷键/命令面板**:`Cmd/Ctrl+K` 唤起命令面板,模糊搜索一键执行
- **可由 Agent 生成的文档一键转换**(见 6.3 末尾)

#### C. Skills 存储与管理

- **SOP 技能包**:存 SQLite `skills` 表(content 为 markdown),或存为本地文件 `skills/*.md` + DB 存元数据(便于版本管理/git)
- **快捷指令**:存 SQLite `quick_actions` 表(steps 存 JSON)
- **UI**:Skills 管理页,分两个 Tab —— "知识包" / "快捷指令";支持新建/编辑/启停/删除/导入导出

### 6.3 需求三:Agent 产出文档沉淀(Docs)

**目标**:Agent 完成一次运维任务后,自动生成可读的复盘/变更文档,沉淀进知识库,供人和 AI 复用。

**什么时候生成**
- **会话结束时**(用户主动点「生成复盘」,或配置为自动)
- **Agent 判定任务完成时**(Agent 自己调 `generate_doc` 工具)

**生成什么(三类文档)**

| 类型 | 触发 | 内容 |
|---|---|---|
| **变更记录** | 任何写操作完成 | 改了哪些文件、重启了什么、回滚方法 |
| **故障复盘** | 排障类会话 | 现象 → 排查过程 → 根因 → 解决 → 预防建议 |
| **操作 SOP** | 用户主动「存为技能」 | 把这次成功的操作流程固化成可复用的步骤 |

**文档结构(Markdown)**

```markdown
---
id: doc_2026_0805_1423
type: postmortem            # change_record / postmortem / sop
title: prod-web-01 nginx 502 故障处理
session_id: sess_a1b2c3
server: prod-web-01 (10.0.1.5)
generated_at: 2026-08-05 14:23
generated_by: agent         # agent / user
tags: [nginx, 502, troubleshooting]
status: draft               # draft / reviewed / archived
---

# prod-web-01 nginx 502 故障处理

## 摘要
14:20 起 prod-web-01 频繁返回 502,根因为上游 php-fpm 进程崩溃,
重启 php-fpm 后恢复,耗时 8 分钟。

## 时间线(自动从审计日志提取)
| 时间 | 操作 | 结果 |
|---|---|---|
| 14:20:11 | systemctl status nginx | nginx 正常 |
| 14:20:23 | tail error.log | 发现 upstream connection refused |
| 14:20:35 | systemctl status php-fpm | failed |
| 14:21:02 | systemctl restart php-fpm | 恢复 |

## 根因
php-fpm OOM 导致崩溃 → upstream 不可达 → nginx 502。

## 解决
重启 php-fpm(临时);建议调整 pm.max_children / 增加内存(长期)。

## 预防
- 配置 php-fpm 监控告警
- 调整内存限制
- 参考 SOP:[nginx-502-troubleshoot]
```

**关键:文档不是凭空生成,而是「从审计日志提取事实 + LLM 总结」**
- 时间线、执行了哪些命令 → 直接从 6.1 的审计日志按 `session_id` 拉取(事实)
- 根因分析、预防建议 → LLM 基于「事实 + 对话上下文」总结(推断)
- **事实部分必须可溯源**:每条时间线都能点回对应的审计日志

**文档 → 技能的转化(打通闭环)**
- 每篇文档有「存为 SOP 技能」按钮:一键把成功流程转成 6.2-A 的技能包
- 或「存为快捷指令」按钮:把操作序列转成 6.2-B 的快捷指令
- 这就是经验反哺 Agent 的入口

**存储**
- SQLite `docs` 表(metadata + content),或本地文件 `docs/*.md` + DB 存元数据
- 状态流转:`draft` → `reviewed`(人审过)→ `archived`
- 支持搜索、按标签/服务器/类型筛选

### 6.4 三者的数据流串联(实现要点)

1. **统一执行出口**:`execute_and_audit()` 是所有命令执行的必经函数 → 同时写 `audit_logs` 表(需求1)。
2. **会话结束时**:拉取该 `session_id` 的所有审计日志 + 对话内容 → 生成 `docs` 文档(需求3)。
3. **文档一键转换**:把成功文档转成 `skills`(SOP)或 `quick_actions`(快捷指令)(需求2)。
4. **Agent 下次执行**:启动时加载启用的 skills → `get_skill` 按需取 → 又走 `execute_and_audit()` → 又产生新日志和新文档 → 闭环。

### 6.5 新增的数据库表

```sql
-- 需求1:操作审计日志
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY,
  timestamp TEXT NOT NULL,           -- ISO8601 毫秒
  session_id TEXT,
  server_id INTEGER,
  server_host TEXT,                  -- 冗余,防删服务器后失真
  source TEXT NOT NULL,             -- agent/manual_terminal/quick_action/mcp_external
  tool_name TEXT NOT NULL,
  command TEXT,
  args TEXT,                        -- JSON
  exit_code INTEGER,
  output TEXT,                      -- 截断
  success INTEGER NOT NULL,         -- 0/1
  approved_by TEXT,
  proposal_id TEXT,
  duration_ms INTEGER
);
CREATE INDEX idx_audit_time ON audit_logs(timestamp);
CREATE INDEX idx_audit_server ON audit_logs(server_id);
CREATE INDEX idx_audit_session ON audit_logs(session_id);

-- 需求2-A:运维 SOP 技能包
CREATE TABLE skills (
  id TEXT PRIMARY KEY,              -- slug, 如 nginx-502-troubleshoot
  title TEXT NOT NULL,
  content TEXT NOT NULL,           -- markdown
  triggers TEXT,                   -- JSON 数组
  tags TEXT,                       -- JSON 数组
  applies_to TEXT,                 -- JSON 数组(server 角色/标签)
  risk_level TEXT DEFAULT 'low',
  enabled INTEGER DEFAULT 1,
  source TEXT,                     -- manual / from_doc
  source_doc_id TEXT,              -- 若由文档转换来
  version INTEGER DEFAULT 1,
  created_at TEXT, updated_at TEXT
);

-- 需求2-B:快捷指令
CREATE TABLE quick_actions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT,
  target TEXT,                     -- JSON: {type, id}
  steps TEXT NOT NULL,             -- JSON 数组
  approval TEXT DEFAULT 'always_ask',
  audit INTEGER DEFAULT 1,
  created_at TEXT, updated_at TEXT
);

-- 需求3:文档沉淀
CREATE TABLE docs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,              -- change_record/postmortem/sop
  title TEXT NOT NULL,
  content TEXT NOT NULL,          -- markdown
  session_id TEXT,
  server_id INTEGER,
  generated_by TEXT,              -- agent/user
  tags TEXT,                      -- JSON
  status TEXT DEFAULT 'draft',    -- draft/reviewed/archived
  created_at TEXT, updated_at TEXT
);
CREATE INDEX idx_docs_type ON docs(type);
CREATE INDEX idx_docs_status ON docs(status);
```

### 6.6 新增的 Agent 工具

在 4.2 的内置工具集基础上,增加:

| 工具 | 说明 | safeToRun |
|---|---|---|
| `get_skill(id)` | 按需加载 SOP 技能包内容(借鉴 MaidKit) | ✅ |
| `list_skills()` | 列出启用的技能(标题+triggers) | ✅ |
| `generate_doc(type, title, content)` | Agent 主动生成文档(复盘/SOP) | ✅ |
| `save_as_skill(doc_id)` | 把文档转成技能 | ✅(只写本地,不动服务器) |

---

## 七、MVP 路线图(分 5 阶段)

### Phase 1 — 地基(2~3 周)
- [ ] Tauri + React + shadcn 工程脚手架
- [ ] Rust 侧 russh 连接管理 + IPC 命令(连接/断开/执行命令)
- [ ] SQLite + Drift 迁移基建
- [ ] 凭证库:主密码 → PBKDF2 → AES-GCM,keychain 集成
- [ ] 基本路由 + 服务器 CRUD 界面

### Phase 2 — 运维能力(2~3 周)
- [ ] xterm.js 终端(输入输出流 + 多标签)
- [ ] SFTP 双栏文件浏览器
- [ ] 服务器监控仪表盘(CPU/内存/网络)
- [ ] 容器列表 + 启停删

### Phase 3 — AI Agent(3~4 周)⭐ 核心
- [ ] Agent loop:流式对话 + tool_calls 解析(自己写 fetch,不用 SDK)
- [ ] Proposal 类型 + 审批 UI(审批卡)
- [ ] RunPolicy 三档策略 + safeToRun 标记
- [ ] 内置工具:run_command / read_file / write_file / get_metrics
- [ ] 会话 JSONL 本地存储
- [ ] CancelToken 跨工具复用
- [ ] **统一执行出口** `execute_and_audit()`:所有命令执行必经此函数,自动写 audit_logs(需求1地基)

### Phase 4 — 运维知识闭环(2~3 周)⭐ 你的差异化
- [ ] **操作审计日志**:audit_logs 表 + 审计页面(按服务器/时间/来源筛选、全文搜索、按会话聚合)(需求1)
- [ ] **Skills 知识包**:skills 表 + `get_skill`/`list_skills` 工具 + 管理页(新建/编辑/启停/导入导出)(需求2-A)
- [ ] **快捷指令**:quick_actions 表 + 多步骤执行器 + 命令面板(Cmd+K)(需求2-B)
- [ ] **文档沉淀**:Agent 会话结束生成复盘文档(从审计日志提取事实 + LLM 总结)(需求3)
- [ ] **文档→技能转换**:一键把成功文档转成 SOP 技能或快捷指令,打通反哺闭环

### Phase 5 — MCP 集成(2~3 周)
- [ ] MCP Client:stdio 子进程管理 + 配置导入(三格式兼容)
- [ ] 工具聚合:内置 + MCP 统一喂给 LLM
- [ ] MCP Server:loopback HTTP+SSE,暴露 SSH 工具
- [ ] McpReviewMode 独立审批

### 后续可选
- 生物识别解锁、云同步、技能市场(对接远程 skills 库)、部署项目管理、自动更新

---

## 八、值得直接抄 MaidKit 的设计决策(技术无关)

| 决策 | 原因 |
|---|---|
| Proposal 与 Execution 强制解耦 | LLM 永远不能直接执行,必须经 UI 审批 |
| 审批策略双轨(App内 vs 外部MCP) | 用户可能想让外部接入更严格 |
| 流式调用自己写 fetch | 保留 DeepSeek 的 reasoning_content,SDK 会丢弃 |
| CancelToken 独立类型 | 跨 SSH/MCP/HTTP 复用取消,不互相依赖 |
| 可变子结构存 JSON 列 | args/env/config 演化无需 DB 迁移 |
| 对话历史不进 vault、不云同步 | 隐私边界,历史只在本机 |
| 待审批 Proposal 不持久化 | 重启即丢,安全兜底 |
| MCP server 启动失败冷却 30s | 避免崩溃子进程反复拉起 |
| MCP 配置三格式兼容 + 容错导入 | 用户粘 Claude/Cline/VSCode 配置即用 |

---

## 八、避坑清单

1. **别用 SDK 调 LLM** —— `dart_openai` 丢 reasoning_content,MaidKit 踩过。前端直接 fetch,后端 Rust 侧也直接 reqwest。
2. **xterm.js 的 SSH relay 在后端** —— xterm.js 只管渲染,SSH 字节流必须走 Rust russh,别想纯前端做。
3. **MCP Dart 官方包是实验性的** —— 这是放弃 Flutter 的核心原因之一。TS SDK 是 Tier 1,稳。
4. **审批门要够醒目** —— 运维误操作代价大,审批卡要清楚地展示「要在哪台机器执行什么命令」,高危操作红色高亮。
5. **输出截断** —— 命令输出超 12000 字符要截断,否则下一轮 LLM 上下文会爆。
6. **host key 首次确认** —— SSH 首连要提示用户确认指纹,之后存下来,防中间人。
7. **新协议版本** —— MCP 目标定 2026-07-28 spec(stateless),新项目别用已 deprecated 的 sampling/logging。
8. **移动端** —— 如果未来真要做手机端,届时再评估 Flutter 重写或 Capacitor,Tauri 移动端还嫩。

---

## 九、下一步

建议立即开始:
1. `npm create tauri-app` 起脚手架(选 React + TS)
2. 装 shadcn/ui + Tailwind
3. Rust 侧加 `russh` 依赖,写第一个 `ssh_connect` IPC 命令
4. 跑通「前端按钮 → Rust 建连 → 执行 `ls` → 返回结果」最小闭环

验证地基 OK 后,再按 Phase 1→4 推进。
