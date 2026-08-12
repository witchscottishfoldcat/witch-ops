//! Agent 会话持久化
//!
//! 设计:
//! - 元信息存 `agent_sessions` 表(id/title/server_id/updated_at 等)
//! - 对话内容存 JSONL 文件(`data/sessions/<id>.jsonl`),每行一条消息
//! - 前端 AgentMessage 直接序列化存盘,加载时反序列化恢复

use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::error::{AppError, AppResult};
use crate::AppState;

/// 存储的消息(前端 AgentMessage 的持久化形式)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredMessage {
    pub id: String,
    pub sender: String,
    pub content: String,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proposal: Option<serde_json::Value>,
}

/// 会话元信息(返回给前端列表用)
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct AgentSessionInfo {
    pub id: String,
    pub title: Option<String>,
    pub server_id: Option<i64>,
    pub model: Option<String>,
    pub tool_calls_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// 获取 data/sessions 目录路径(不存在则创建)
fn sessions_dir(data_dir: &PathBuf) -> AppResult<PathBuf> {
    let dir = data_dir.join("sessions");
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::Internal(format!("创建 sessions 目录失败: {e}")))?;
    Ok(dir)
}

/// JSONL 文件路径
fn transcript_path(data_dir: &PathBuf, session_id: &str) -> AppResult<PathBuf> {
    Ok(sessions_dir(data_dir)?.join(format!("{session_id}.jsonl")))
}

/// 创建新会话
#[tauri::command]
pub async fn create_agent_session(
    state: State<'_, AppState>,
    title: Option<String>,
    server_id: Option<i64>,
    model: Option<String>,
) -> AppResult<String> {
    let id = format!("sess_{}", uuid::Uuid::new_v4().simple());
    let transcript = format!("sessions/{id}.jsonl");

    sqlx::query(
        "INSERT INTO agent_sessions (id, title, server_id, model, transcript_path)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&title)
    .bind(server_id)
    .bind(&model)
    .bind(&transcript)
    .execute(state.db())
    .await?;

    // 创建空 JSONL 文件
    let path = transcript_path(&state.data_dir, &id)?;
    tokio::fs::File::create(&path).await
        .map_err(|e| AppError::Internal(format!("创建会话文件失败: {e}")))?;

    log::info!("[session] 创建会话 {id} title={:?} server={:?}", title, server_id);
    Ok(id)
}

/// 列出所有会话(按更新时间倒序)
#[tauri::command]
pub async fn list_agent_sessions(state: State<'_, AppState>) -> AppResult<Vec<AgentSessionInfo>> {
    let sessions = sqlx::query_as::<_, AgentSessionInfo>(
        "SELECT id, title, server_id, model, tool_calls_count, created_at, updated_at
         FROM agent_sessions ORDER BY datetime(updated_at) DESC",
    )
    .fetch_all(state.db())
    .await?;
    Ok(sessions)
}

/// 加载会话的全部消息
#[tauri::command]
pub async fn load_agent_messages(
    state: State<'_, AppState>,
    session_id: String,
) -> AppResult<Vec<StoredMessage>> {
    let path = transcript_path(&state.data_dir, &session_id)?;
    let mut file = match tokio::fs::File::open(&path).await {
        Ok(f) => f,
        Err(_) => return Ok(Vec::new()), // 文件不存在视为空会话
    };

    let mut contents = String::new();
    file.read_to_string(&mut contents).await
        .map_err(|e| AppError::Internal(format!("读取会话文件失败: {e}")))?;

    let mut messages = Vec::new();
    for line in contents.lines() {
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<StoredMessage>(line) {
            Ok(msg) => messages.push(msg),
            Err(e) => log::warn!("会话 {session_id} 消息解析失败,跳过: {e}"),
        }
    }

    // 按 id 去重:同一消息可能被多次持久化(流式→最终),取最后一条
    let mut result: Vec<StoredMessage> = Vec::new();
    let mut index: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for msg in messages {
        if let Some(&i) = index.get(&msg.id) {
            result[i] = msg; // 原位置替换(保持顺序)
        } else {
            index.insert(msg.id.clone(), result.len());
            result.push(msg);
        }
    }
    Ok(result)
}

/// 追加一条消息到会话
#[tauri::command]
pub async fn append_agent_message(
    state: State<'_, AppState>,
    session_id: String,
    message: StoredMessage,
) -> AppResult<()> {
    let path = transcript_path(&state.data_dir, &session_id)?;

    // 序列化为一行 JSON + 换行
    let line = serde_json::to_string(&message)
        .map_err(|e| AppError::Internal(format!("消息序列化失败: {e}")))?;

    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .await
        .map_err(|e| AppError::Internal(format!("打开会话文件失败: {e}")))?;

    file.write_all(line.as_bytes()).await
        .map_err(|e| AppError::Internal(format!("写入会话失败: {e}")))?;
    file.write_all(b"\n").await
        .map_err(|e| AppError::Internal(format!("写入换行失败: {e}")))?;

    log::info!("[session] 追加消息到 {session_id}: {} ({}字节)", message.id, line.len());

    // 更新会话的 updated_at
    sqlx::query("UPDATE agent_sessions SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
        .bind(&session_id)
        .execute(state.db())
        .await?;

    Ok(())
}

/// 重命名会话
#[tauri::command]
pub async fn rename_agent_session(
    state: State<'_, AppState>,
    id: String,
    title: String,
) -> AppResult<()> {
    sqlx::query("UPDATE agent_sessions SET title = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
        .bind(&title)
        .bind(&id)
        .execute(state.db())
        .await?;
    Ok(())
}

/// 删除会话(表记录 + JSONL 文件)
#[tauri::command]
pub async fn delete_agent_session(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<()> {
    sqlx::query("DELETE FROM agent_sessions WHERE id = ?")
        .bind(&id)
        .execute(state.db())
        .await?;

    let path = transcript_path(&state.data_dir, &id)?;
    let _ = tokio::fs::remove_file(&path).await; // 文件不存在不算错误

    Ok(())
}
