//! 数据模型(供 IPC 命令层使用,与前端共享的类型)

use serde::{Deserialize, Serialize};

/// 服务器(前端可见,凭证字段为加密密文)
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Server {
    pub id: i64,
    pub name: String,
    pub host: String,
    pub port: i64,
    pub username: String,
    pub auth_method: String,
    /// 加密密文(base64),前端不直接用,展示时为 null
    pub credential_enc: Option<String>,
    pub proxy: Option<String>,
    pub host_key_fingerprint: Option<String>,
    /// JSON 数组字符串
    pub tags: Option<String>,
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// 新建/更新服务器的输入(credential 为明文,后端加密后存储)
#[derive(Debug, Clone, Deserialize)]
pub struct ServerInput {
    pub name: String,
    pub host: String,
    #[serde(default = "default_port")]
    pub port: i64,
    pub username: String,
    #[serde(default = "default_auth")]
    pub auth_method: String,
    /// 明文凭证(密码或私钥 PEM),后端用 vault 加密
    pub credential: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub note: Option<String>,
}

fn default_port() -> i64 {
    22
}
fn default_auth() -> String {
    "password".into()
}

impl ServerInput {
    pub fn validate(&self) -> crate::error::AppResult<()> {
        if self.name.trim().is_empty() {
            return Err(crate::error::AppError::InvalidInput("名称不能为空".into()));
        }
        if self.host.trim().is_empty() {
            return Err(crate::error::AppError::InvalidInput("主机不能为空".into()));
        }
        if self.username.trim().is_empty() {
            return Err(crate::error::AppError::InvalidInput("用户名不能为空".into()));
        }
        Ok(())
    }
}

/// 技能包(SOP)
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Skill {
    pub id: String,
    pub title: String,
    pub content: String,
    pub triggers: Option<String>,
    pub tags: Option<String>,
    pub applies_to: Option<String>,
    pub risk_level: String,
    pub enabled: bool,
    pub source: String,
    pub source_doc_id: Option<String>,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// 快捷指令
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct QuickAction {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    pub target: Option<String>,
    pub steps: String,
    pub approval: String,
    pub audit: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// 文档(沉淀)
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Doc {
    pub id: String,
    #[serde(rename = "type")]
    pub doc_type: String,
    pub title: String,
    pub content: String,
    pub session_id: Option<String>,
    pub server_id: Option<i64>,
    pub generated_by: Option<String>,
    pub tags: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Agent 会话元信息
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct AgentSession {
    pub id: String,
    pub title: Option<String>,
    pub server_ids: Option<String>,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub transcript_path: Option<String>,
    pub tool_calls_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// LLM Provider 档案(api_key 为加密密文)
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct AgentProvider {
    pub id: String,
    pub name: String,
    pub base_url: String,
    /// 加密密文,前端展示为 *** 
    pub api_key_enc: String,
    pub default_model: Option<String>,
    pub models: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// 新建/更新 Provider 的输入(api_key 为明文)
#[derive(Debug, Clone, Deserialize)]
pub struct ProviderInput {
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    #[serde(default)]
    pub default_model: Option<String>,
    #[serde(default)]
    pub models: Option<Vec<String>>,
}

/// MCP Server 配置
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct McpServer {
    pub id: String,
    pub name: String,
    pub transport: String,
    pub command: Option<String>,
    pub args: Option<String>,
    pub env_enc: Option<String>,
    pub url: Option<String>,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// 审计日志查询过滤条件
#[derive(Debug, Clone, Deserialize, Default)]
pub struct AuditFilter {
    #[serde(default)]
    pub server_id: Option<i64>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub success: Option<bool>,
    /// 命令内容模糊搜索
    #[serde(default)]
    pub search: Option<String>,
    /// ISO 时间范围
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub to: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default = "default_offset")]
    pub offset: i64,
}

fn default_limit() -> i64 {
    100
}
fn default_offset() -> i64 {
    0
}
