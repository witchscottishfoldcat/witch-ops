# MaidKit 源码吸收分析 + witchcat-ops 实施 Plan

> 基于 2026-08-05 对 Solsynth/MaidKit(master 分支)核心源码的亲自阅读。
> 目的:摸清 MaidKit 有什么功能 → 挑出我们该吸收的知识 → 制定 witchcat-ops 的实施计划。

---

## 一、MaidKit 完整功能全景(我读到的)

### 1.1 模块划分(按 lib/ 目录)

```
lib/
├── agent/      (18 文件) AI Agent 全家桶:MCP、技能、会话、审批、计费
├── servers/    (65 文件) 服务器管理:连接、终端、文件、容器、Web服务器、监控...
├── containers/ (17 文件) Docker/Podman 容器 + Compose + 部署项目
├── snippets/   (2 文件)  可复用 shell 脚本
├── data/local/ (2 文件)  Drift 数据库(schemaVersion=19)
├── routing/    (2 文件)  auto_route 路由
├── shared/     (~11 文件) 复用 UI 壳 + 更新服务
└── 根 (3 文件)  main/app/theme
```

### 1.2 servers/ 的 65 个文件揭示了这些功能

| 类别 | 功能 | 对应文件 |
|---|---|---|
| **连接** | SSH 连接管理、代理(HTTP CONNECT/SOCKS5)、启动自动连接、host key | ssh_connection_manager / ssh_proxy_connect / startup_* |
| **终端** | 多标签终端、ghostty 适配、命令面板、查找、配色、分屏布局 | terminal_session_adapter / ghostty_* / terminal_* / session_layout |
| **文件** | SFTP 双栏浏览、内置文件编辑器、结构化文档 | file_management_tab / file_editor_tab / structured_document |
| **监控** | CPU/内存/网络采集、定时刷新、活动流 | server_metrics_collector / *_refresh_scheduler / activity_* |
| **服务** | systemd 服务管理 | systemd_models / systemd_tab |
| **Web 服务器** | nginx / Caddy 反向代理配置(适配器模式) | nginx_web_server_adapter / caddy_* / web_server_* |
| **防火墙** | 防火墙规则管理 | firewall_models / firewall_tab |
| **端口转发** | SSH 端口转发 | port_forwarding_* |
| **定时任务** | crontab 管理 | crontab_* |
| **包管理** | apt/dnf 等包管理 | package_management_tab / package_models |
| **VPN/组网** | Tailscale 集成、Tailscale SSH socket | tailscale_service / tailscale_ssh_socket / tailscale_settings |
| **凭证库** | AES-GCM vault、文件存储、解锁门 | vault_service / vault_file_storage / vault_gate / credentials_page |
| **同步** | 云同步、数据库备份 | cloud_sync_service / database_backup_service |

### 1.3 containers/ 的 17 个文件揭示的功能

- 容器列表、详情、启停删、镜像管理
- **Compose 项目**:详情页、编辑器、生命周期管理、合并日志
- **部署项目**(DeploymentProject):目录栏、资源管理、项目仓库
- 容器运行时安装器、缓存仓储

### 1.4 agent/ 的 18 个文件揭示的功能(我重点读了 ssh_agent_service.dart 的真实代码)

| 文件 | 职责 |
|---|---|
| **ssh_agent_service.dart** | Agent 核心引擎:流式对话、工具调用、Proposal 生成/执行/续轮 |
| mcp_client.dart | MCP 客户端(自研 JSON-RPC over stdio) |
| local_mcp_server.dart | MCP 服务端(HTTP+SSE,暴露 SSH 能力给外部 Agent) |
| mcp_repository.dart / mcp_config_parser.dart | MCP server 配置 CRUD + 三格式导入(VSCode/Cline/Claude) |
| skill_registry.dart / skill_repository.dart | 技能注册表 + 远程 skills.sh 搜索 |
| conversation_store.dart | 会话存 JSONL(本机、不云同步) |
| agent_run_policy.dart | App 内 Agent 审批策略(always_ask/auto_review/always_approve) |
| mcp_review_mode.dart | 外部 MCP 接入审批策略(独立第二套) |
| agent_cancel_token.dart | 跨 SSH/MCP 复用的取消令牌 |
| agent_repository.dart | LLM provider 档案(API key 加密) |
| personality_service.dart | 外部人格核心 |
| billing_service.dart | 用量计费(Solsynth 自家体系) |
| agent_personality / agent_selection / agent_input_focus | 用户偏好 |

---

## 二、MaidKit Agent 工作流的真实实现(我读到的源码)

这是最值钱的部分,我把真实代码结构提炼出来。核心在 `ssh_agent_service.dart`。

### 2.1 暴露给 LLM 的工具(真实 schema)

```
run_command(server_id, command, safe_to_run)
read_file(server_id, path, safe_to_run)
write_file(server_id, path, content, safe_to_run)
delete_file(server_id, path, safe_to_run)
create_snippet(name, script, safe_to_run)     ← 存到本地 snippet 库
run_snippet(server_id, snippet_id, safe_to_run)
get_skill(...)                                 ← 动态注入,仅当有启用技能时
mcp_<serverId>__<toolName>(...)                ← 动态注入的 MCP 工具
```

**关键**:每个工具都带 `safe_to_run` 布尔参数,让模型自己标记这次调用是否安全。

### 2.2 单轮循环的真实流程(5 步)

```
request()
  → _streamChat()     流式拉取,累积 text + reasoning + tool_calls
                      ⚠️ 自己走原始 http,不走 dart_openai(后者丢 reasoning_content)
  → _turn()           把流式结果解析成 AgentTurn(含 AgentProposal)

[UI 展示 Proposal,等待审批]

executeProposal(client, proposal)
  → 用已建立的 SSHClient 执行(run_command / read_file / write_file...)
  → 注册 cancelToken → session.close() 可中止
  → 输出 _limit() 截断到 12000 字符

continueAfterExecution()
  → 把 assistant 消息(含 reasoning_content)+ tool 结果消息 塞回 history
  → 再 _streamChat() → _turn()  → 可能又出 Proposal → 循环
```

### 2.3 三个我从真实代码里确认的关键设计

**① Proposal 与 Execution 强制解耦**
`executeProposal` 是 static 方法,接收一个**外部传入的已建立 SSHClient**。Service 自己不持有连接、不在 `request()` 里执行。注释明确:"Runs the remote half of proposal over client. Shared by the chat page and the local MCP server so both entry points execute actions identically." —— **聊天页和本地 MCP server 两个入口共用同一个执行函数**。

**② reasoning_content 必须回传**
DeepSeek 等推理模型返回 `reasoning_content`,`continueAfterExecution` 里手动把它塞回 assistant 消息:`assistant['reasoning_content'] = reasoningContent`。注释:"The API requires a tool message for every tool call... this app approves one action at a time, so narrow the message down to the approved call." —— **只回放被批准的那一个 tool_call**,不回放并行的其他调用。

**③ safeToRun 的判定逻辑**
```dart
bool get safeToRun =>
    arguments['safe_to_run'] as bool? ??
    kind == AgentActionKind.readFile || kind == AgentActionKind.getSkill;
```
模型标记 safe → true;否则 read_file 和 get_skill 天生只读 → true;其余 → false(需审批)。

### 2.4 MaidKit 架构文档(ARCHITECTURE.md)和 AGENTS.md 的硬性规则

- **扁平 feature 结构**:`lib/<feature>/`,禁止 data/domain/presentation 分层(除非 feature 大到需要)
- **单一 AppDatabase**:所有表集中,迁移集中,schemaVersion 单调升
- **绝不在 Drift 存私钥/凭证**:必须用安全存储
- **UI 哲学**:安静、功能性、桌面导向。**禁止渐变、发光、毛玻璃、装饰性 hero、假仪表盘**。用边框和对比建立层级,间距遵循 4/8/12/16/24/32 刻度。
- 路由用 auto_route,**绝不手改 *.g.dart / *.gr.dart**
- 改动前先读 architecture.md

---

## 三、吸收判断:MaidKit 的每个东西,我们要不要

### ✅ 必须吸收(直接照搬设计思想,用我们的技术栈重写)

| MaidKit 的东西 | 为什么吸收 | 我们的实现 |
|---|---|---|
| **Proposal 与 Execution 解耦** | 安全命脉,LLM 不能直接执行 | TS AgentService 生成 Proposal,Rust 执行 |
| **统一执行入口** | 聊天/MCP/快捷指令共用 execute | Rust `execute_and_audit()` |
| **流式自己写 fetch** | SDK 丢 reasoning_content | TS 直接 fetch SSE |
| **safe_to_run 标记** | 审批分流依据 | 工具 schema 注入布尔字段 |
| **reasoning_content 回传** | DeepSeek 兼容必需 | 续轮时塞回 assistant 消息 |
| **CancelToken 独立类型** | 跨 SSH/MCP 复用 | TS class + 注册回调 |
| **输出截断** | 防 token 爆炸 | 12000 字符 |
| **MCP 双向** | client + server 都做 | TS SDK(client)+ Rust rmcp(server) |
| **MCP 配置三格式兼容** | 用户粘配置即用 | 解析 VSCode/Cline/Claude 格式 |
| **审批策略双轨** | 外部接入可更严 | App 内 + MCP 各一套 |
| **扁平 feature 结构** | 简单、不过度设计 | `src/<feature>/` |
| **单一数据库 + JSON 列** | 可变结构免迁移 | SQLite + JSON 列 |
| **凭证不入明文表** | 安全 | 加密列 + keychain |
| **对话历史不云同步** | 隐私边界 | 本机 JSONL |
| **待审批 Proposal 不持久化** | 安全兜底 | 重启即丢 |

### 🔶 部分吸收(简化或改造)

| MaidKit 的东西 | 我们的取舍 |
|---|---|
| 技能系统(skills.sh 远程市场) | **只做本地**,不接远程市场(v1) |
| 人格系统(personality_service 外部部署) | **不做**,用一个可配置的系统提示足矣 |
| 计费系统(billing_service) | **不做**,这是 Solsynth 商业化东西 |
| ghostty 终端适配 | **不做**,我们用 xterm.js,不需要多终端后端 |
| UI 哲学(禁止装饰) | **吸收精神**:克制、专业、不花哨 |

### ❌ 不吸收(我们技术栈不同或不必要)

| MaidKit 的东西 | 原因 |
|---|---|
| Flutter / Dart / Riverpod / auto_route / Drift | 我们用 Tauri + React + TS |
| dartssh2 | 我们用 Rust russh |
| 自研 MCP 客户端(纯 Dart) | 我们用官方 TS SDK(Tier 1),不造轮子 |
| dart_openai | 我们自己 fetch |
| Tailscale 集成 | v1 不做,复杂度高 |
| 云同步 / 数据库备份 | v1 不做 |

### ➕ 我们要做、但 MaidKit 没有的(我们的差异化)

| 我们独有 | 说明 |
|---|---|
| **操作审计日志**(audit_logs) | MaidKit 没有独立的审计日志表,我们有 |
| **文档沉淀**(Agent 产出复盘/变更/SOP) | MaidKit 没有,我们有 |
| **快捷指令**(一键多步骤操作) | MaidKit 只有 snippet(单脚本),我们有可视化多步骤+条件+命令面板 |
| **文档→技能一键转化** | MaidKit 没有,我们打通经验飞轮闭环 |

---

## 四、witchcat-ops 实施 Plan

### 4.1 项目信息

- **目录**:`D:\ADM\witchcat-ops`
- **技术栈**:Tauri 2 + React + TypeScript + Rust + xterm.js + russh + 官方 MCP TS SDK + SQLite
- **定位**:AI Agent 服务器运维工具,带审计/Skills/文档沉淀的运维知识闭环

### 4.2 实施阶段(6 个 Phase)

#### Phase 0 — 工程脚手架(2~3 天)
**目标**:跑通空壳应用,验证 Tauri + React + Rust 链路。

- [ ] `npm create tauri-app`(选 React + TypeScript)
- [ ] 接 Tailwind CSS + shadcn/ui
- [ ] Rust 侧加依赖:`russh`、`rusqlite`(或 `sqlx`)、`ring`、`serde`
- [ ] SQLite 初始化 + 迁移基建(建 `app.db`,第一张表 `servers`)
- [ ] 跑通最小闭环:前端按钮 → Rust IPC `ping` → 返回;再加一个 `ssh_test_connect`
- [ ] 基本路由布局(侧边栏:服务器 / 终端 / Agent / 审计 / Skills / 文档 / 设置)

**验收**:应用能启动,侧边栏能切换空页面,SQLite 能读写。

#### Phase 1 — SSH 地基 + 凭证库(1 周)
**目标**:能连服务器、能存加密凭证。

- [ ] Rust:`russh` 连接管理器(连接池、host key 首次确认存指纹)
- [ ] Rust:凭证库 —— 主密码 → PBKDF2(31 万次)→ 派生 key → AES-GCM-256 加密
- [ ] Rust:OS keychain 集成(存 wrapped key)
- [ ] IPC:`ssh_connect` / `ssh_disconnect` / `ssh_execute`(返回结果)
- [ ] 前端:服务器 CRUD 界面、凭证库解锁界面
- [ ] **统一执行出口雏形**:`execute_and_audit()` 函数(Rust 侧),先只执行不审计,Phase 3 接审计

**验收**:能添加服务器、解锁凭证库、连上 SSH 跑 `ls` 看到结果。

#### Phase 2 — 运维能力(1.5~2 周)
**目标**:核心运维 UI 可用。

- [ ] xterm.js 终端封装(输入→IPC→russh→输出流;多标签;主题)
- [ ] SFTP 双栏文件浏览器(列目录、上传下载、重命名删除)
- [ ] 服务器监控仪表盘(CPU/内存/网络,定时采集)
- [ ] 容器列表 + 启停删(调 `docker`/`podman` CLI via SSH)
- [ ] systemd 服务列表 + 启停

**验收**:能在终端里操作,能传文件,能看到监控曲线,能管容器。

#### Phase 3 — AI Agent 核心 ⭐(2 周)
**目标**:Agent 能对话、能提案、能(审批后)执行。

- [ ] TS:`AgentService` —— 流式对话(自己写 fetch SSE)
- [ ] TS:`_streamChat` 等价物 —— 累积 text + reasoning_content + tool_calls
- [ ] TS:`Proposal` 类型 + `safeToRun` 判定
- [ ] TS:内置工具定义(run_command/read_file/write_file/delete_file/get_metrics),schema 带 safe_to_run
- [ ] TS:`executeProposal` —— 调 Rust IPC 执行,**接 audit_logs 写入**(统一执行出口正式启用)
- [ ] TS:`continueAfterExecution` —— reasoning_content 回传、续轮循环
- [ ] TS:`CancelToken` class
- [ ] 前端:Agent 聊天界面 + **审批卡**(展示命令/参数/目标服务器/高危红色高亮)
- [ ] RunPolicy 三档(always_ask / auto_review / always_approve)+ 设置页
- [ ] 会话 JSONL 本地存储

**验收**:跟 Agent 说"看一下 nginx 状态",它提案 `systemctl status nginx`,审批后执行,返回结果,它再总结。

#### Phase 4 — 运维知识闭环 ⭐(我们的差异化,2 周)
**目标**:审计 + Skills + 文档三件套打通。

- [ ] **审计日志**:`audit_logs` 表;Rust 侧 `execute_and_audit()` 正式写日志;前端审计页(按服务器/时间/来源/成败筛选、命令全文搜索、按 session 聚合查看)
- [ ] **Skills 知识包**:`skills` 表(markdown);`get_skill`/`list_skills` 工具;管理页(新建/编辑/启停/导入导出);系统提示注入启用技能标题
- [ ] **快捷指令**:`quick_actions` 表;多步骤执行器(命令串联、条件 guard、引用上一步输出、高危确认);`Cmd+K` 命令面板
- [ ] **文档沉淀**:`docs` 表;会话结束生成复盘(从 audit_logs 拉 session 事实 + LLM 总结);文档状态流转(draft→reviewed→archived)
- [ ] **文档→技能转化**:文档页"存为 SOP 技能"/"存为快捷指令"按钮

**验收**:Agent 排障一次 → 审计页能看到完整操作链 → 生成复盘文档 → 一键转成技能 → 下次同类问题 Agent 能 `get_skill` 复用。

#### Phase 5 — MCP 集成(1.5~2 周)
**目标**:既能调外部 MCP 工具,也能被外部 Agent 调用。

- [ ] TS:用 `@modelcontextprotocol/sdk` 起 MCP client
- [ ] stdio 子进程管理(每个 server 一个 client,失败 30s 冷却)
- [ ] 配置导入(三格式兼容 + 容错)
- [ ] 工具聚合:内置 + MCP 统一喂 LLM,命名空间 `mcp_<id>__<name>`
- [ ] Rust:`rmcp` 起 loopback HTTP+SSE server(默认 8746),暴露 run_command/read_file/write_file
- [ ] McpReviewMode 独立审批策略

**验收**:配置一个 MCP server(如 filesystem),Agent 能调它的工具;外部 Claude Desktop 能连进我们的 server 操作 SSH。

### 4.3 吸收清单 → 代码映射(写代码时对照)

| MaidKit 源文件 | 对应我们的实现 | 放哪 |
|---|---|---|
| ssh_agent_service.dart | `src/agent/agent-service.ts` | 前端 TS |
| AgentProposal / safeToRun | `src/agent/proposal.ts` | 前端 TS |
| AgentCancelToken | `src/agent/cancel-token.ts` | 前端 TS |
| executeProposal | `src-tauri/src/ssh/executor.rs` 的 `execute_and_audit()` | Rust |
| conversation_store.dart | `src/agent/conversation-store.ts` | 前端 TS(JSONL) |
| mcp_client.dart | 用 `@modelcontextprotocol/sdk` 替代 | 前端 TS |
| local_mcp_server.dart | `src-tauri/src/mcp_server/` | Rust(rmcp) |
| mcp_config_parser.dart | `src/agent/mcp-config-parser.ts` | 前端 TS |
| agent_run_policy / mcp_review_mode | `src/agent/run-policy.ts` | 前端 TS |
| vault_service.dart | `src-tauri/src/vault/` | Rust(ring+keychain) |
| app_database.dart | `src-tauri/src/db/schema.sql` + Drizzle | Rust/TS |
| skill_registry / skill_repository | `src/skills/` | 前端 TS + DB |

### 4.4 关键原则(写代码时牢记)

1. **LLM 永远不直接执行** —— Proposal 必须经审批卡,才传连接执行
2. **所有命令走 execute_and_audit** —— 不管来源,审计无遗漏
3. **流式自己 fetch** —— 不用 LLM SDK,保留 reasoning_content
4. **可变结构存 JSON 列** —— args/env/config 不建独立列
5. **凭证加密 + keychain** —— 绝不明文存
6. **对话历史本机** —— 不进 vault,不云同步,待审批 Proposal 不持久化
7. **UI 克制** —— 学 MaidKit:无渐变/发光/毛玻璃,边框+对比建层级,4/8 间距刻度

---

## 五、下一步建议

立即可以开始 **Phase 0 工程脚手架**,我可以帮你在 `D:\ADM\witchcat-ops` 里:
1. 跑 `npm create tauri-app` 起 React+TS 工程
2. 配 Tailwind + shadcn/ui
3. Rust 侧加 russh + SQLite 依赖
4. 写第一个 IPC 命令跑通前后端闭环
5. 搭侧边栏路由骨架

确认后我就动手。
