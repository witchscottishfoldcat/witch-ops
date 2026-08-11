//! 统一执行出口 —— 安全命脉
//!
//! 借鉴 MaidKit:所有命令执行(不管来源是 Agent / 手动终端 / 快捷指令 / 外部 MCP),
//! **都必须经过 [`execute_and_audit`]**,保证审计日志无遗漏。
//!
//! 这对应 MaidKit 的 `ssh_agent_service.dart::executeProposal` 的执行部分,
//! 但扩展为跨来源的统一入口。

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::error::AppResult;
use crate::ssh::{CommandResult, SshManager};

/// 审计日志记录的输入(执行上下文)
#[derive(Debug, Clone, Deserialize)]
pub struct AuditContext {
    /// 操作来源:agent / manual_terminal / quick_action / mcp_external
    pub source: String,
    /// 关联的会话 ID(Agent 流程用)
    #[serde(default)]
    pub session_id: Option<String>,
    /// 工具名:run_command / read_file / write_file / ...
    pub tool_name: String,
    /// 实际命令(对 run_command 即命令字符串)
    #[serde(default)]
    pub command: Option<String>,
    /// 参数(JSON 字符串)
    #[serde(default)]
    pub args: Option<String>,
    /// 审批人/策略:"user:zhang" 或 "policy:auto_review"
    #[serde(default)]
    pub approved_by: Option<String>,
    /// 关联的提案 ID
    #[serde(default)]
    pub proposal_id: Option<String>,
}

/// 审计日志记录(返回给前端查看用)
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct AuditLog {
    pub id: i64,
    pub timestamp: String,
    pub session_id: Option<String>,
    pub server_id: Option<i64>,
    pub server_host: Option<String>,
    pub source: String,
    pub tool_name: String,
    pub command: Option<String>,
    pub args: Option<String>,
    pub exit_code: Option<i32>,
    pub output: Option<String>,
    pub success: bool,
    pub approved_by: Option<String>,
    pub proposal_id: Option<String>,
    pub duration_ms: Option<i64>,
}

/// 审计日志输出截断阈值(防 token 爆炸,借鉴 MaidKit 的 12000 字符)
const OUTPUT_TRUNCATE: usize = 2000;

/// 统一执行 + 审计出口
///
/// 这是所有 SSH 命令执行的**唯一**入口(对于 run_command 类操作)。
/// 执行命令 → 自动写审计日志 → 返回结果。
///
/// 返回 (命令结果, 审计日志 ID)
pub async fn execute_and_audit(
    ssh: &SshManager,
    db: &SqlitePool,
    server_id: i64,
    server_host: &str,
    command: &str,
    ctx: &AuditContext,
) -> AppResult<(CommandResult, i64)> {
    let start = std::time::Instant::now();

    log::info!(
        "[audit] 执行 server={server_id} tool={} source={} cmd={:?}",
        ctx.tool_name,
        ctx.source,
        command
    );

    // 执行命令
    let result = ssh.run_command(server_id, command).await;
    let duration_ms = start.elapsed().as_millis() as i64;

    let (success, exit_code, _output, truncated_output) = match &result {
        Ok(r) => {
            let combined = r.combined_output();
            let truncated = truncate_output(&combined);
            (r.success(), Some(r.exit_code), Some(combined), truncated)
        }
        Err(e) => (false, None, Some(e.to_string()), truncate_output(&e.to_string())),
    };

    // 写审计日志
    let timestamp = Utc::now().to_rfc3339();
    let audit_id = match write_audit_log(
        db,
        &timestamp,
        ctx.session_id.as_deref(),
        Some(server_id),
        Some(server_host),
        &ctx.source,
        &ctx.tool_name,
        ctx.command.as_deref().or(Some(command)),
        ctx.args.as_deref(),
        exit_code,
        Some(&truncated_output),
        success,
        ctx.approved_by.as_deref(),
        ctx.proposal_id.as_deref(),
        duration_ms,
    )
    .await
    {
        Ok(id) => id,
        Err(e) => {
            // 审计失败不应吞掉已执行的命令结果:
            // 命令确实执行了,降级返回结果并显式告警(审计缺口可查)
            log::error!(
                "审计日志写入失败(命令已执行,server={server_id}): {e}"
            );
            -1
        }
    };

    let result = result?;
    Ok((result, audit_id))
}

/// 仅记录审计日志(不执行,用于 read_file 等不需要 SSH 执行的操作记录)
#[allow(clippy::too_many_arguments)]
pub async fn log_action(
    db: &SqlitePool,
    server_id: Option<i64>,
    server_host: Option<&str>,
    success: bool,
    output: Option<&str>,
    ctx: &AuditContext,
) -> AppResult<i64> {
    let timestamp = Utc::now().to_rfc3339();
    let truncated = output.map(truncate_output);
    write_audit_log(
        db,
        &timestamp,
        ctx.session_id.as_deref(),
        server_id,
        server_host,
        &ctx.source,
        &ctx.tool_name,
        ctx.command.as_deref(),
        ctx.args.as_deref(),
        None,
        truncated.as_deref(),
        success,
        ctx.approved_by.as_deref(),
        ctx.proposal_id.as_deref(),
        0,
    )
    .await
}

/// 截断输出到 OUTPUT_TRUNCATE 字符
fn truncate_output(s: &str) -> String {
    if s.len() <= OUTPUT_TRUNCATE {
        s.to_string()
    } else {
        // 按字节边界回退到合法 UTF-8 边界,避免切断多字节字符
        let mut i = OUTPUT_TRUNCATE;
        while i > 0 && !s.is_char_boundary(i) {
            i -= 1;
        }
        format!(
            "{}\n...(输出已截断,共 {} 字符)",
            &s[..i],
            s.chars().count()
        )
    }
}

/// 写审计日志到数据库
#[allow(clippy::too_many_arguments)]
async fn write_audit_log(
    db: &SqlitePool,
    timestamp: &str,
    session_id: Option<&str>,
    server_id: Option<i64>,
    server_host: Option<&str>,
    source: &str,
    tool_name: &str,
    command: Option<&str>,
    args: Option<&str>,
    exit_code: Option<i32>,
    output: Option<&str>,
    success: bool,
    approved_by: Option<&str>,
    proposal_id: Option<&str>,
    duration_ms: i64,
) -> AppResult<i64> {
    use sqlx::Row;

    let row = sqlx::query(
        "INSERT INTO audit_logs
            (timestamp, session_id, server_id, server_host, source, tool_name,
             command, args, exit_code, output, success, approved_by, proposal_id, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id",
    )
    .bind(timestamp)
    .bind(session_id)
    .bind(server_id)
    .bind(server_host)
    .bind(source)
    .bind(tool_name)
    .bind(command)
    .bind(args)
    .bind(exit_code)
    .bind(output)
    .bind(success)
    .bind(approved_by)
    .bind(proposal_id)
    .bind(duration_ms)
    .fetch_one(db)
    .await?;

    let id: i64 = row.try_get("id")?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_short_output_unchanged() {
        let s = "hello world";
        assert_eq!(truncate_output(s), s);
    }

    #[test]
    fn truncate_long_output_appends_note() {
        let s = "x".repeat(3000);
        let t = truncate_output(&s);
        assert!(t.len() < s.len());
        assert!(t.ends_with("...(输出已截断,共 3000 字符)"), "尾部注释: {t}");
    }

    #[test]
    fn truncate_never_cuts_multibyte_utf8() {
        // 中文 3 字节/字符,构造恰好跨越截断边界的长字符串
        let s = "运维自动化运维自动化".repeat(200);
        assert!(s.len() > OUTPUT_TRUNCATE);
        let t = truncate_output(&s);
        // 结果必须是合法 UTF-8(截断按字符边界回退,不得 panic/产生非法字节)
        assert!(String::from_utf8(t.clone().into_bytes()).is_ok());
        assert!(t.contains("...(输出已截断"));
    }

    #[test]
    fn truncate_exact_boundary_ok() {
        let s = "y".repeat(OUTPUT_TRUNCATE);
        assert_eq!(truncate_output(&s), s);
    }
}
