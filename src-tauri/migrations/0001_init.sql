-- Witchcat Ops 初始数据库 Schema
-- 设计原则(借鉴 MaidKit):
--   1. 可变子结构(args/env/config)一律存 JSON 列,避免频繁迁移
--   2. 敏感数据(凭证、API key)存 AES-GCM 密文,绝不存明文
--   3. 审计日志独立于会话,可单独保留
--   4. 会话内容不进数据库,存本地 JSONL 文件(隐私边界)

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================
-- 服务器
-- ============================================================
CREATE TABLE IF NOT EXISTS servers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  host            TEXT    NOT NULL,
  port            INTEGER NOT NULL DEFAULT 22,
  username        TEXT    NOT NULL,
  -- 认证方式:password / private_key / saved_credential
  auth_method     TEXT    NOT NULL DEFAULT 'password',
  -- 加密后的凭证(密码或私钥,AES-GCM-256 密文,base64)
  credential_enc  TEXT,
  -- 可选代理(存 JSON: {type: "http"|"socks5", host, port, username, password_enc})
  proxy           TEXT,
  -- 已确认的 host key 指纹(SHA256 hex),首连时由用户确认后存入
  host_key_fingerprint TEXT,
  -- 服务器角色/标签(存 JSON 数组,用于 skills 的 applies_to 匹配)
  tags            TEXT,
  -- 备注
  note            TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ============================================================
-- 可复用的加密 SSH 凭证
-- ============================================================
CREATE TABLE IF NOT EXISTS saved_credentials (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  kind            TEXT    NOT NULL,           -- password / private_key
  -- AES-GCM-256 密文(base64)
  secret_enc      TEXT    NOT NULL,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ============================================================
-- 凭证库元数据(Vault)
-- 存 salt、wrapped data key、verifier(用于校验主密码是否正确)
-- ============================================================
CREATE TABLE IF NOT EXISTS vault_metadata (
  id              INTEGER PRIMARY KEY CHECK (id = 1),  -- 单行表
  -- PBKDF2 盐(16 字节,hex)
  salt            TEXT    NOT NULL,
  -- 用主密码派生出的 key 包装后的 data key(AES-GCM 密文,base64)
  -- data key 用于加密所有敏感数据;它本身存 OS keychain,这里存"包装"版本作为备份
  wrapped_data_key TEXT,
  -- verifier:一段已知明文的密文,解锁时尝试解密它,成功则说明主密码正确
  verifier        TEXT    NOT NULL,
  -- PBKDF2 迭代次数
  iterations      INTEGER NOT NULL DEFAULT 310000,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ============================================================
-- 需求1:操作审计日志(统一执行出口写入)
-- 所有命令执行(不管来源)都走这里留痕
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  -- ISO8601 毫秒精度
  timestamp       TEXT    NOT NULL,
  -- 关联的 Agent 会话 ID(手动终端操作可为空)
  session_id      TEXT,
  server_id       INTEGER,
  -- 冗余存 host,防服务器删除后审计记录失真
  server_host     TEXT,
  -- 操作来源:agent / manual_terminal / quick_action / mcp_external
  source          TEXT    NOT NULL,
  -- 工具名:run_command / read_file / write_file / delete_file 等
  tool_name       TEXT    NOT NULL,
  -- 实际命令(对 run_command 即命令字符串)
  command         TEXT,
  -- 参数(JSON)
  args            TEXT,
  exit_code       INTEGER,
  -- 输出(截断,默认前 2000 字符)
  output          TEXT,
  -- 是否成功
  success         INTEGER NOT NULL DEFAULT 0,
  -- 审批人/策略:如 "user:zhang" 或 "policy:auto_review"
  approved_by     TEXT,
  -- 关联的提案 ID(Agent 流程用)
  proposal_id     TEXT,
  -- 执行耗时(毫秒)
  duration_ms     INTEGER,
  FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_time    ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_server  ON audit_logs(server_id);
CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_audit_source  ON audit_logs(source);

-- ============================================================
-- 需求2-A:运维 SOP 技能包(给 AI 看,markdown)
-- ============================================================
CREATE TABLE IF NOT EXISTS skills (
  id              TEXT    PRIMARY KEY,        -- slug, 如 nginx-502-troubleshoot
  title           TEXT    NOT NULL,
  content         TEXT    NOT NULL,           -- markdown 正文
  -- 触发词(JSON 数组),用于匹配后提示 Agent 调用 get_skill
  triggers        TEXT,                       -- JSON
  tags            TEXT,                       -- JSON 数组
  -- 适用的服务器角色/标签(JSON 数组)
  applies_to      TEXT,                       -- JSON
  risk_level      TEXT    NOT NULL DEFAULT 'low',  -- low / medium / high
  enabled         INTEGER NOT NULL DEFAULT 1,
  -- 来源:manual / from_doc
  source          TEXT    NOT NULL DEFAULT 'manual',
  source_doc_id   TEXT,
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ============================================================
-- 需求2-B:快捷指令(一键多步骤操作)
-- ============================================================
CREATE TABLE IF NOT EXISTS quick_actions (
  id              TEXT    PRIMARY KEY,
  name            TEXT    NOT NULL,
  icon            TEXT,
  -- 目标(JSON: {type: "server"|"group", id})
  target          TEXT,
  -- 步骤(JSON 数组: [{type:"command", value, capture, guard, confirm}, ...])
  steps           TEXT    NOT NULL,
  -- 审批策略:always_ask / auto_review / always_approve
  approval        TEXT    NOT NULL DEFAULT 'always_ask',
  audit           INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ============================================================
-- 需求3:文档沉淀(Agent 产出的复盘/变更/SOP)
-- ============================================================
CREATE TABLE IF NOT EXISTS docs (
  id              TEXT    PRIMARY KEY,
  -- 类型:change_record / postmortem / sop
  type            TEXT    NOT NULL,
  title           TEXT    NOT NULL,
  content         TEXT    NOT NULL,           -- markdown
  session_id      TEXT,
  server_id       INTEGER,
  -- 生成者:agent / user
  generated_by    TEXT,
  tags            TEXT,                       -- JSON 数组
  -- 状态:draft / reviewed / archived
  status          TEXT    NOT NULL DEFAULT 'draft',
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_docs_type   ON docs(type);
CREATE INDEX IF NOT EXISTS idx_docs_status ON docs(status);

-- ============================================================
-- Agent 会话元信息(实际对话内容存本地 JSONL 文件)
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_sessions (
  id              TEXT    PRIMARY KEY,        -- sess_xxx
  title           TEXT,
  -- 关联的服务器(JSON 数组,server_id 列表)
  server_ids      TEXT,
  -- LLM provider ID
  provider_id     TEXT,
  model           TEXT,
  -- JSONL 文件路径(相对于 app data dir)
  transcript_path TEXT,
  -- 工具调用次数统计
  tool_calls_count INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ============================================================
-- LLM Provider 档案(API key 加密存储)
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_providers (
  id              TEXT    PRIMARY KEY,
  name            TEXT    NOT NULL,           -- 显示名
  base_url        TEXT    NOT NULL,           -- 如 https://api.deepseek.com
  -- 加密的 API key(AES-GCM 密文,base64)
  api_key_enc     TEXT    NOT NULL,
  -- 默认模型
  default_model   TEXT,
  -- 可用模型列表(JSON 数组)
  models          TEXT,                       -- JSON
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ============================================================
-- MCP Server 配置(客户端模式:调外部 MCP server)
-- ============================================================
CREATE TABLE IF NOT EXISTS mcp_servers (
  id              TEXT    PRIMARY KEY,
  name            TEXT    NOT NULL,
  -- 传输方式:stdio / http
  transport       TEXT    NOT NULL DEFAULT 'stdio',
  -- stdio:可执行程序路径
  command         TEXT,
  -- 参数(JSON 数组)
  args            TEXT,                       -- JSON
  -- 环境变量(JSON 对象,值可能含密钥,整体加密)
  env_enc         TEXT,
  -- http 模式的 URL
  url             TEXT,
  enabled         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
