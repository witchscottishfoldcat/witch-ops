-- Agent 提案:服务端审批状态机。前端只能创建提案、请求批准/拒绝,
-- 执行必须经 execute_agent_proposal 校验 approved 状态,前端无法伪造审批。
CREATE TABLE IF NOT EXISTS agent_proposals (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    server_id INTEGER,
    tool_name TEXT NOT NULL,
    command TEXT,
    args TEXT,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending / approved / rejected / executed
    approved_by TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    approved_at TEXT
);
