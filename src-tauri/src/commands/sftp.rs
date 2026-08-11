//! SFTP 文件操作命令
//!
//! 每个命令打开一次 SFTP 子系统会话执行操作。
//! (实现简单;若需高频操作,可后续优化为复用 session)
//!
//! 设计约定:所有**写操作**(write/delete/mkdir/rmdir/rename)必须调用
//! [`crate::executor::log_action`] 留审计痕迹 —— 与"一切命令皆审计"的统一出口原则一致。

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::executor::{log_action, AuditContext};
use crate::AppState;

/// 查询服务器 host(用于审计记录),失败返回空串
async fn fetch_server_host(state: &State<'_, AppState>, server_id: i64) -> String {
    use sqlx::Row;
    sqlx::query("SELECT host FROM servers WHERE id = ?")
        .bind(server_id)
        .fetch_optional(state.db())
        .await
        .ok()
        .flatten()
        .and_then(|r| r.try_get::<String, _>("host").ok())
        .unwrap_or_default()
}

/// 写操作执行 + 审计的公共包装:
/// 无论成功失败都写审计日志;审计写库失败只告警,不吞掉操作结果。
async fn audit_sftp_action(
    state: &State<'_, AppState>,
    server_id: i64,
    tool_name: &str,
    args: serde_json::Value,
    op: impl std::future::Future<Output = AppResult<()>>,
) -> AppResult<()> {
    let server_host = fetch_server_host(state, server_id).await;
    let ctx = AuditContext {
        source: "sftp".into(),
        session_id: None,
        tool_name: tool_name.into(),
        command: None,
        args: Some(args.to_string()),
        approved_by: Some("user".into()),
        proposal_id: None,
    };

    let result = op.await;
    let (success, output) = match &result {
        Ok(()) => (true, None),
        Err(e) => (false, Some(e.to_string())),
    };
    match log_action(
        state.db(),
        Some(server_id),
        Some(&server_host),
        success,
        output.as_deref(),
        &ctx,
    )
    .await
    {
        Ok(_) => {}
        Err(e) => log::warn!("SFTP {tool_name} 审计写库失败: {e}"),
    }
    result
}

/// 目录条目
#[derive(Debug, Clone, Serialize)]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified: Option<String>,
    pub permissions: Option<u32>,
}

/// 列出目录
#[tauri::command]
pub async fn sftp_list_dir(
    state: State<'_, AppState>,
    server_id: i64,
    path: String,
) -> AppResult<Vec<DirEntry>> {
    log::info!("SFTP list_dir: server={server_id} path='{path}'");
    let sftp = state.ssh.open_sftp(server_id).await.map_err(|e| {
        log::error!("SFTP 子系统打开失败(server={server_id}): {e}");
        e
    })?;
    let entries = sftp
        .read_dir(&path)
        .await
        .map_err(|e| {
            log::error!("SFTP read_dir('{path}') 失败: {e}");
            AppError::Ssh(format!("读取目录失败: {e}"))
        })?;

    let mut result = Vec::new();
    for entry in entries {
        let name = entry.file_name();
        if name == "." || name == ".." {
            continue;
        }
        let meta = entry.metadata();
        let is_dir = meta.is_dir();
        let is_symlink = meta.is_symlink();
        let size = meta.len();
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| {
                chrono::DateTime::from_timestamp(d.as_secs() as i64, 0)
                    .map(|dt| dt.to_rfc3339())
                    .unwrap_or_default()
            });
        let permissions = meta.permissions;
        result.push(DirEntry {
            name,
            is_dir,
            is_symlink,
            size,
            modified,
            permissions,
        });
    }
    // 目录在前,文件在后,各自按名字排序
    result.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    log::info!("SFTP read_dir('{path}') 成功: {} 个条目", result.len());
    Ok(result)
}

/// 读取文本文件(限 1MB)
#[tauri::command]
pub async fn sftp_read_file(
    state: State<'_, AppState>,
    server_id: i64,
    path: String,
) -> AppResult<String> {
    let sftp = state.ssh.open_sftp(server_id).await?;

    // 先 stat 大小:避免把超大文件整个读进内存后才拒绝(OOM 风险)
    if let Ok(meta) = sftp.metadata(&path).await {
        if meta.is_dir() {
            return Err(AppError::InvalidInput("这是一个目录,无法作为文本读取".into()));
        }
        if meta.len() > 1024 * 1024 {
            return Err(AppError::InvalidInput(format!(
                "文件 {:.1} MB 超过 1MB 限制,请下载后用专门编辑器打开",
                meta.len() as f64 / 1024.0 / 1024.0
            )));
        }
    }

    let mut file = sftp
        .open(&path)
        .await
        .map_err(|e| AppError::Ssh(format!("打开文件失败: {e}")))?;

    use tokio::io::AsyncReadExt;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)
        .await
        .map_err(|e| AppError::Ssh(format!("读取文件失败: {e}")))?;

    String::from_utf8(buf).map_err(|_| AppError::InvalidInput("文件不是合法 UTF-8 文本(可能是二进制文件)".into()))
}

/// 写入文本文件
#[tauri::command]
pub async fn sftp_write_file(
    state: State<'_, AppState>,
    server_id: i64,
    path: String,
    content: String,
) -> AppResult<()> {
    let args = serde_json::json!({ "path": path });
    audit_sftp_action(&state, server_id, "write_file", args, async {
        let sftp = state.ssh.open_sftp(server_id).await?;

        use russh_sftp::protocol::OpenFlags;
        let mut file = sftp
            .open_with_flags(
                &path,
                OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
            )
            .await
            .map_err(|e| AppError::Ssh(format!("打开文件失败: {e}")))?;

        use tokio::io::AsyncWriteExt;
        file.write_all(content.as_bytes())
            .await
            .map_err(|e| AppError::Ssh(format!("写入失败: {e}")))?;
        file.flush()
            .await
            .map_err(|e| AppError::Ssh(format!("flush 失败: {e}")))?;
        Ok(())
    })
    .await
}

/// 删除文件
#[tauri::command]
pub async fn sftp_delete_file(
    state: State<'_, AppState>,
    server_id: i64,
    path: String,
) -> AppResult<()> {
    let args = serde_json::json!({ "path": path });
    audit_sftp_action(&state, server_id, "delete_file", args, async {
        let sftp = state.ssh.open_sftp(server_id).await?;
        sftp.remove_file(&path)
            .await
            .map_err(|e| AppError::Ssh(format!("删除文件失败: {e}")))?;
        Ok(())
    })
    .await
}

/// 创建目录
#[tauri::command]
pub async fn sftp_mkdir(
    state: State<'_, AppState>,
    server_id: i64,
    path: String,
) -> AppResult<()> {
    let args = serde_json::json!({ "path": path });
    audit_sftp_action(&state, server_id, "mkdir", args, async {
        let sftp = state.ssh.open_sftp(server_id).await?;
        sftp.create_dir(&path)
            .await
            .map_err(|e| AppError::Ssh(format!("创建目录失败: {e}")))?;
        Ok(())
    })
    .await
}

/// 删除目录
#[tauri::command]
pub async fn sftp_rmdir(
    state: State<'_, AppState>,
    server_id: i64,
    path: String,
) -> AppResult<()> {
    let args = serde_json::json!({ "path": path });
    audit_sftp_action(&state, server_id, "rmdir", args, async {
        let sftp = state.ssh.open_sftp(server_id).await?;
        sftp.remove_dir(&path)
            .await
            .map_err(|e| AppError::Ssh(format!("删除目录失败: {e}")))?;
        Ok(())
    })
    .await
}

/// 重命名
#[tauri::command]
pub async fn sftp_rename(
    state: State<'_, AppState>,
    server_id: i64,
    from: String,
    to: String,
) -> AppResult<()> {
    let args = serde_json::json!({ "from": from, "to": to });
    audit_sftp_action(&state, server_id, "rename", args, async {
        let sftp = state.ssh.open_sftp(server_id).await?;
        sftp.rename(&from, &to)
            .await
            .map_err(|e| AppError::Ssh(format!("重命名失败: {e}")))?;
        Ok(())
    })
    .await
}

/// 路径信息(规范路径、是否存在)
#[derive(Debug, Serialize, Deserialize)]
pub struct PathInfo {
    pub canonical: String,
    pub exists: bool,
    pub is_dir: bool,
    pub size: u64,
}

/// 获取路径规范形式
#[tauri::command]
pub async fn sftp_stat(
    state: State<'_, AppState>,
    server_id: i64,
    path: String,
) -> AppResult<PathInfo> {
    let sftp = state.ssh.open_sftp(server_id).await?;
    match sftp.metadata(&path).await {
        Ok(meta) => Ok(PathInfo {
            canonical: path,
            exists: true,
            is_dir: meta.is_dir(),
            size: meta.len(),
        }),
        Err(_) => Ok(PathInfo {
            canonical: path,
            exists: false,
            is_dir: false,
            size: 0,
        }),
    }
}
