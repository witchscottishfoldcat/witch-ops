//! SFTP 文件操作命令
//!
//! 每个命令打开一次 SFTP 子系统会话执行操作。
//! (实现简单;若需高频操作,可后续优化为复用 session)

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::AppState;

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
    let sftp = state.ssh.open_sftp(server_id).await?;
    let entries = sftp
        .read_dir(&path)
        .await
        .map_err(|e| AppError::Ssh(format!("读取目录失败: {e}")))?;

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
    let mut file = sftp
        .open(&path)
        .await
        .map_err(|e| AppError::Ssh(format!("打开文件失败: {e}")))?;

    use tokio::io::AsyncReadExt;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)
        .await
        .map_err(|e| AppError::Ssh(format!("读取文件失败: {e}")))?;

    if buf.len() > 1024 * 1024 {
        return Err(AppError::InvalidInput("文件超过 1MB,请用专门的编辑器".into()));
    }
    String::from_utf8(buf).map_err(|_| AppError::InvalidInput("文件不是合法 UTF-8 文本".into()))
}

/// 写入文本文件
#[tauri::command]
pub async fn sftp_write_file(
    state: State<'_, AppState>,
    server_id: i64,
    path: String,
    content: String,
) -> AppResult<()> {
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
}

/// 删除文件
#[tauri::command]
pub async fn sftp_delete_file(
    state: State<'_, AppState>,
    server_id: i64,
    path: String,
) -> AppResult<()> {
    let sftp = state.ssh.open_sftp(server_id).await?;
    sftp.remove_file(&path)
        .await
        .map_err(|e| AppError::Ssh(format!("删除文件失败: {e}")))?;
    Ok(())
}

/// 创建目录
#[tauri::command]
pub async fn sftp_mkdir(
    state: State<'_, AppState>,
    server_id: i64,
    path: String,
) -> AppResult<()> {
    let sftp = state.ssh.open_sftp(server_id).await?;
    sftp.create_dir(&path)
        .await
        .map_err(|e| AppError::Ssh(format!("创建目录失败: {e}")))?;
    Ok(())
}

/// 删除目录
#[tauri::command]
pub async fn sftp_rmdir(
    state: State<'_, AppState>,
    server_id: i64,
    path: String,
) -> AppResult<()> {
    let sftp = state.ssh.open_sftp(server_id).await?;
    sftp.remove_dir(&path)
        .await
        .map_err(|e| AppError::Ssh(format!("删除目录失败: {e}")))?;
    Ok(())
}

/// 重命名
#[tauri::command]
pub async fn sftp_rename(
    state: State<'_, AppState>,
    server_id: i64,
    from: String,
    to: String,
) -> AppResult<()> {
    let sftp = state.ssh.open_sftp(server_id).await?;
    sftp.rename(&from, &to)
        .await
        .map_err(|e| AppError::Ssh(format!("重命名失败: {e}")))?;
    Ok(())
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
