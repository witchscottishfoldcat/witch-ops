//! 服务器管理相关 IPC 命令

use tauri::State;

use crate::error::{AppError, AppResult};
use crate::executor::{execute_and_audit, AuditContext};
use crate::models::{Server, ServerInput};
use crate::AppState;

/// 列出所有服务器
#[tauri::command]
pub async fn list_servers(state: State<'_, AppState>) -> AppResult<Vec<Server>> {
    let servers = sqlx::query_as::<_, Server>("SELECT * FROM servers ORDER BY name")
        .fetch_all(state.db())
        .await?;
    Ok(servers)
}

/// 获取单个服务器
#[tauri::command]
pub async fn get_server(state: State<'_, AppState>, id: i64) -> AppResult<Server> {
    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
        .bind(id)
        .fetch_optional(state.db())
        .await?
        .ok_or_else(|| AppError::NotFound(format!("服务器 {id}")))?;
    Ok(server)
}

/// 新建服务器(credential 为明文,后端用 vault 加密)
#[tauri::command]
pub async fn create_server(
    state: State<'_, AppState>,
    input: ServerInput,
) -> AppResult<i64> {
    input.validate()?;

    let credential_enc = match (&input.auth_method, &input.credential) {
        (_, Some(cred)) if !cred.is_empty() => {
            let vault = state.require_vault()?;
            Some(vault.encrypt_str(cred)?)
        }
        _ => None,
    };

    let tags_json = input
        .tags
        .as_ref()
        .map(|t| serde_json::to_string(t).unwrap_or_default());

    use sqlx::Row;
    let row = sqlx::query(
        "INSERT INTO servers (name, host, port, username, auth_method, credential_enc, tags, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id",
    )
    .bind(&input.name)
    .bind(&input.host)
    .bind(input.port)
    .bind(&input.username)
    .bind(&input.auth_method)
    .bind(&credential_enc)
    .bind(&tags_json)
    .bind(&input.note)
    .fetch_one(state.db())
    .await?;

    let id: i64 = row.try_get("id")?;
    Ok(id)
}

/// 更新服务器
#[tauri::command]
pub async fn update_server(
    state: State<'_, AppState>,
    id: i64,
    input: ServerInput,
) -> AppResult<()> {
    input.validate()?;

    // 如果提供了新凭证,重新加密;否则保留原值
    let credential_enc = if let Some(cred) = &input.credential {
        if !cred.is_empty() {
            let vault = state.require_vault()?;
            Some(vault.encrypt_str(cred)?)
        } else {
            None
        }
    } else {
        // 不改凭证:查原值
        use sqlx::Row;
        let row =
            sqlx::query("SELECT credential_enc FROM servers WHERE id = ?")
                .bind(id)
                .fetch_optional(state.db())
                .await?;
        row.and_then(|r| r.try_get::<Option<String>, _>("credential_enc").ok())
            .flatten()
    };

    let tags_json = input
        .tags
        .as_ref()
        .map(|t| serde_json::to_string(t).unwrap_or_default());

    sqlx::query(
        "UPDATE servers SET name=?, host=?, port=?, username=?, auth_method=?,
         credential_enc=?, tags=?, note=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id=?",
    )
    .bind(&input.name)
    .bind(&input.host)
    .bind(input.port)
    .bind(&input.username)
    .bind(&input.auth_method)
    .bind(&credential_enc)
    .bind(tags_json)
    .bind(&input.note)
    .bind(id)
    .execute(state.db())
    .await?;

    Ok(())
}

/// 删除服务器
#[tauri::command]
pub async fn delete_server(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    // 先断开连接
    state.ssh.disconnect(id).await.ok();
    sqlx::query("DELETE FROM servers WHERE id = ?")
        .bind(id)
        .execute(state.db())
        .await?;
    Ok(())
}

/// 连接服务器(用存储的加密凭证解密后连接)
///
/// 返回 host key 指纹(首连时前端应展示给用户确认)
#[tauri::command]
pub async fn connect_server(state: State<'_, AppState>, id: i64) -> AppResult<String> {
    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
        .bind(id)
        .fetch_optional(state.db())
        .await?
        .ok_or_else(|| AppError::NotFound(format!("服务器 {id}")))?;

    if state.ssh.is_connected(id).await {
        return Ok(server.host_key_fingerprint.unwrap_or_default());
    }

    // 解密凭证
    let vault = state.require_vault()?;
    let credential = server
        .credential_enc
        .as_ref()
        .ok_or_else(|| AppError::Vault(format!("服务器 {} 未设置凭证", server.name)))?;
    let credential_plain = vault.decrypt_str(credential)?;

    let port = server.port as u16;
    match server.auth_method.as_str() {
        "password" => state
            .ssh
            .connect_with_password(
                id,
                &server.host,
                port,
                &server.username,
                &credential_plain,
                server.host_key_fingerprint.clone(),
            )
            .await,
        "private_key" => state
            .ssh
            .connect_with_key(
                id,
                &server.host,
                port,
                &server.username,
                &credential_plain,
                None,
                server.host_key_fingerprint.clone(),
            )
            .await,
        other => Err(AppError::InvalidInput(format!(
            "不支持的认证方式: {other}"
        ))),
    }
    // 指纹由前端拿到后存回(见 confirm_host_key 命令)
}

/// 确认 host key 指纹(首连后用户确认,存入数据库)
#[tauri::command]
pub async fn confirm_host_key(
    state: State<'_, AppState>,
    id: i64,
    fingerprint: String,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE servers SET host_key_fingerprint=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
    )
    .bind(&fingerprint)
    .bind(id)
    .execute(state.db())
    .await?;
    Ok(())
}

/// 断开服务器连接
#[tauri::command]
pub async fn disconnect_server(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    state.ssh.disconnect(id).await
}

/// 查询服务器连接状态
#[tauri::command]
pub async fn server_connection_status(
    state: State<'_, AppState>,
    id: i64,
) -> AppResult<bool> {
    Ok(state.ssh.is_connected(id).await)
}

/// 在服务器上执行命令(经统一执行出口,自动审计)
///
/// 这是 Agent / 快捷指令 / 手动执行共同使用的入口。
#[tauri::command]
pub async fn execute_command(
    state: State<'_, AppState>,
    server_id: i64,
    command: String,
    ctx: AuditContext,
) -> AppResult<serde_json::Value> {
    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
        .bind(server_id)
        .fetch_optional(state.db())
        .await?
        .ok_or_else(|| AppError::NotFound(format!("服务器 {server_id}")))?;

    let (result, audit_id) =
        execute_and_audit(&state.ssh, state.db(), server_id, &server.host, &command, &ctx).await?;

    Ok(serde_json::json!({
        "audit_id": audit_id,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "exit_code": result.exit_code,
        "success": result.success(),
    }))
}
