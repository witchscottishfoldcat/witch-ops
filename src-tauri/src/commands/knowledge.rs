//! 知识闭环相关命令:审计日志 / Skills / 快捷指令 / 文档沉淀
//!
//! 这三个需求(记录Agent操作、设置skills、收集运维文档)的核心实现。

use tauri::State;

use crate::error::{AppError, AppResult};
use crate::executor::AuditLog;
use crate::models::{AuditFilter, Doc, QuickAction, Skill};
use crate::AppState;

// ============================================================
// 审计日志(需求1)
// ============================================================

/// 查询审计日志(支持筛选)
#[tauri::command]
pub async fn query_audit_logs(
    state: State<'_, AppState>,
    filter: AuditFilter,
) -> AppResult<Vec<AuditLog>> {
    // 动态拼 SQL(sqlx 运行时模式,参数化绑定)
    let mut where_clauses: Vec<String> = Vec::new();
    let mut binds: Vec<String> = Vec::new();
    let mut idx = 1;

    // 用 JSON 数组记录绑定值的类型,再逐个绑定(此处简化:全部按 String 绑定,sqlx 会处理类型)
    // 为避免类型复杂性,这里用一个辅助宏式写法

    let sql = build_audit_query(&filter);
    let mut q = sqlx::query_as::<_, AuditLog>(&sql);

    if let Some(v) = &filter.server_id {
        q = q.bind(v);
    }
    if let Some(v) = &filter.session_id {
        q = q.bind(v);
    }
    if let Some(v) = &filter.source {
        q = q.bind(v);
    }
    if let Some(v) = filter.success {
        q = q.bind(v);
    }
    if let Some(v) = &filter.search {
        q = q.bind(format!("%{v}%"));
    }
    if let Some(v) = &filter.from {
        q = q.bind(v);
    }
    if let Some(v) = &filter.to {
        q = q.bind(v);
    }
    q = q.bind(filter.limit);
    q = q.bind(filter.offset);

    let _ = (where_clauses, binds, idx); // 占位避免未使用警告
    let logs = q.fetch_all(state.db()).await?;
    Ok(logs)
}

/// 构建审计查询 SQL(参数用 ? 占位,顺序与 binds 一致)
fn build_audit_query(f: &AuditFilter) -> String {
    let mut clauses = Vec::new();
    if f.server_id.is_some() {
        clauses.push("server_id = ?");
    }
    if f.session_id.is_some() {
        clauses.push("session_id = ?");
    }
    if f.source.is_some() {
        clauses.push("source = ?");
    }
    if f.success.is_some() {
        clauses.push("success = ?");
    }
    if f.search.is_some() {
        clauses.push("(command LIKE ? OR tool_name LIKE ? OR output LIKE ?)");
    }
    if f.from.is_some() {
        clauses.push("timestamp >= ?");
    }
    if f.to.is_some() {
        clauses.push("timestamp <= ?");
    }

    let where_sql = if clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", clauses.join(" AND "))
    };

    format!(
        "SELECT * FROM audit_logs {where_sql} ORDER BY timestamp DESC LIMIT ? OFFSET ?"
    )
}

/// 获取某次会话的所有审计日志(按时间正序,用于复盘)
#[tauri::command]
pub async fn get_session_audit_logs(
    state: State<'_, AppState>,
    session_id: String,
) -> AppResult<Vec<AuditLog>> {
    let logs = sqlx::query_as::<_, AuditLog>(
        "SELECT * FROM audit_logs WHERE session_id = ? ORDER BY timestamp ASC",
    )
    .bind(session_id)
    .fetch_all(state.db())
    .await?;
    Ok(logs)
}

/// 获取审计日志统计(总数 / 成功率)
#[tauri::command]
pub async fn audit_stats(state: State<'_, AppState>) -> AppResult<serde_json::Value> {
    use sqlx::Row;
    let total: i64 = sqlx::query("SELECT COUNT(*) AS c FROM audit_logs")
        .fetch_one(state.db())
        .await?
        .try_get("c")
        .unwrap_or(0);
    let success: i64 =
        sqlx::query("SELECT COUNT(*) AS c FROM audit_logs WHERE success = 1")
            .fetch_one(state.db())
            .await?
            .try_get("c")
            .unwrap_or(0);
    Ok(serde_json::json!({
        "total": total,
        "success": success,
        "failed": total - success,
    }))
}

// ============================================================
// Skills - 运维 SOP 技能包(需求2-A)
// ============================================================

/// 列出所有技能
#[tauri::command]
pub async fn list_skills(state: State<'_, AppState>) -> AppResult<Vec<Skill>> {
    let skills = sqlx::query_as::<_, Skill>("SELECT * FROM skills ORDER BY title")
        .fetch_all(state.db())
        .await?;
    Ok(skills)
}

/// 列出启用的技能(注入 Agent 系统提示用)
#[tauri::command]
pub async fn list_enabled_skills(state: State<'_, AppState>) -> AppResult<Vec<Skill>> {
    let skills =
        sqlx::query_as::<_, Skill>("SELECT * FROM skills WHERE enabled = 1 ORDER BY title")
            .fetch_all(state.db())
            .await?;
    Ok(skills)
}

/// 获取单个技能完整内容(Agent get_skill 工具调用此命令)
#[tauri::command]
pub async fn get_skill(state: State<'_, AppState>, id: String) -> AppResult<Skill> {
    sqlx::query_as::<_, Skill>("SELECT * FROM skills WHERE id = ?")
        .bind(&id)
        .fetch_optional(state.db())
        .await?
        .ok_or_else(|| AppError::NotFound(format!("技能 {id}")))
}

/// 新建/更新技能(upsert)
#[tauri::command]
pub async fn upsert_skill(state: State<'_, AppState>, skill: Skill) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO skills (id, title, content, triggers, tags, applies_to, risk_level,
                             enabled, source, source_doc_id, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            title=excluded.title, content=excluded.content, triggers=excluded.triggers,
            tags=excluded.tags, applies_to=excluded.applies_to, risk_level=excluded.risk_level,
            enabled=excluded.enabled, source=excluded.source, source_doc_id=excluded.source_doc_id,
            version=excluded.version + 1,
            updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
    )
    .bind(&skill.id)
    .bind(&skill.title)
    .bind(&skill.content)
    .bind(&skill.triggers)
    .bind(&skill.tags)
    .bind(&skill.applies_to)
    .bind(&skill.risk_level)
    .bind(skill.enabled)
    .bind(&skill.source)
    .bind(&skill.source_doc_id)
    .bind(skill.version)
    .execute(state.db())
    .await?;
    Ok(())
}

/// 删除技能
#[tauri::command]
pub async fn delete_skill(state: State<'_, AppState>, id: String) -> AppResult<()> {
    sqlx::query("DELETE FROM skills WHERE id = ?")
        .bind(id)
        .execute(state.db())
        .await?;
    Ok(())
}

/// 启用/禁用技能
#[tauri::command]
pub async fn toggle_skill(
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE skills SET enabled=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
    )
    .bind(enabled)
    .bind(id)
    .execute(state.db())
    .await?;
    Ok(())
}

// ============================================================
// 快捷指令(需求2-B)
// ============================================================

/// 列出所有快捷指令
#[tauri::command]
pub async fn list_quick_actions(state: State<'_, AppState>) -> AppResult<Vec<QuickAction>> {
    let actions =
        sqlx::query_as::<_, QuickAction>("SELECT * FROM quick_actions ORDER BY name")
            .fetch_all(state.db())
            .await?;
    Ok(actions)
}

/// 新建/更新快捷指令
#[tauri::command]
pub async fn upsert_quick_action(
    state: State<'_, AppState>,
    action: QuickAction,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO quick_actions (id, name, icon, target, steps, approval, audit)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            name=excluded.name, icon=excluded.icon, target=excluded.target,
            steps=excluded.steps, approval=excluded.approval, audit=excluded.audit,
            updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
    )
    .bind(&action.id)
    .bind(&action.name)
    .bind(&action.icon)
    .bind(&action.target)
    .bind(&action.steps)
    .bind(&action.approval)
    .bind(action.audit)
    .execute(state.db())
    .await?;
    Ok(())
}

/// 删除快捷指令
#[tauri::command]
pub async fn delete_quick_action(state: State<'_, AppState>, id: String) -> AppResult<()> {
    sqlx::query("DELETE FROM quick_actions WHERE id = ?")
        .bind(id)
        .execute(state.db())
        .await?;
    Ok(())
}

// ============================================================
// 文档沉淀(需求3)
// ============================================================

/// 列出文档
#[tauri::command]
pub async fn list_docs(state: State<'_, AppState>) -> AppResult<Vec<Doc>> {
    let docs = sqlx::query_as::<_, Doc>(
        "SELECT * FROM docs ORDER BY datetime(created_at) DESC",
    )
    .fetch_all(state.db())
    .await?;
    Ok(docs)
}

/// 获取单个文档
#[tauri::command]
pub async fn get_doc(state: State<'_, AppState>, id: String) -> AppResult<Doc> {
    sqlx::query_as::<_, Doc>("SELECT * FROM docs WHERE id = ?")
        .bind(&id)
        .fetch_optional(state.db())
        .await?
        .ok_or_else(|| AppError::NotFound(format!("文档 {id}")))
}

/// 新建/更新文档
#[tauri::command]
pub async fn upsert_doc(state: State<'_, AppState>, doc: Doc) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO docs (id, type, title, content, session_id, server_id, generated_by,
                           tags, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            type=excluded.type, title=excluded.title, content=excluded.content,
            session_id=excluded.session_id, server_id=excluded.server_id,
            generated_by=excluded.generated_by, tags=excluded.tags, status=excluded.status,
            updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
    )
    .bind(&doc.id)
    .bind(&doc.doc_type)
    .bind(&doc.title)
    .bind(&doc.content)
    .bind(&doc.session_id)
    .bind(doc.server_id)
    .bind(&doc.generated_by)
    .bind(&doc.tags)
    .bind(&doc.status)
    .execute(state.db())
    .await?;
    Ok(())
}

/// 更新文档状态(draft → reviewed → archived)
#[tauri::command]
pub async fn update_doc_status(
    state: State<'_, AppState>,
    id: String,
    status: String,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE docs SET status=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
    )
    .bind(&status)
    .bind(&id)
    .execute(state.db())
    .await?;
    Ok(())
}

/// 删除文档
#[tauri::command]
pub async fn delete_doc(state: State<'_, AppState>, id: String) -> AppResult<()> {
    sqlx::query("DELETE FROM docs WHERE id = ?")
        .bind(id)
        .execute(state.db())
        .await?;
    Ok(())
}

/// 把文档转换为技能(打通经验飞轮闭环)
#[tauri::command]
pub async fn doc_to_skill(
    state: State<'_, AppState>,
    doc_id: String,
    skill_id: String,
    title: String,
) -> AppResult<()> {
    // 直接查文档(不经过 command 函数,避免 State clone 问题)
    let doc = sqlx::query_as::<_, Doc>("SELECT * FROM docs WHERE id = ?")
        .bind(&doc_id)
        .fetch_optional(state.db())
        .await?
        .ok_or_else(|| AppError::NotFound(format!("文档 {doc_id}")))?;

    sqlx::query(
        "INSERT INTO skills (id, title, content, triggers, tags, applies_to, risk_level,
                             enabled, source, source_doc_id, version)
         VALUES (?, ?, ?, NULL, ?, NULL, 'low', 1, 'from_doc', ?, 1)
         ON CONFLICT(id) DO UPDATE SET
            title=excluded.title, content=excluded.content, tags=excluded.tags,
            source_doc_id=excluded.source_doc_id,
            version=excluded.version + 1,
            updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
    )
    .bind(&skill_id)
    .bind(&title)
    .bind(&doc.content)
    .bind(&doc.tags)
    .bind(&doc_id)
    .execute(state.db())
    .await?;

    Ok(())
}
