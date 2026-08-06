//! Witchcat Ops 后端入口
//!
//! 架构(扁平 feature 结构,借鉴 MaidKit):
//! - `db`     数据库初始化
//! - `error`  统一错误类型
//! - `vault`  凭证库(PBKDF2 + AES-GCM-256 + keychain)
//! - `ssh`    SSH 连接管理(russh 0.62)
//! - `executor` 统一执行出口 execute_and_audit(安全命脉)
//! - `models` 数据模型
//! - `commands` IPC 命令层(供前端调用)

pub mod commands;
pub mod db;
pub mod error;
pub mod executor;
pub mod models;
pub mod ssh;
pub mod terminal;
pub mod vault;

use std::sync::Arc;
use sqlx::SqlitePool;
use tauri::Manager;
use tokio::sync::RwLock;

use crate::error::AppError;
use crate::ssh::SshManager;
use crate::vault::Vault;

/// 全局应用状态(通过 Tauri managed state 共享给所有命令)
pub struct AppState {
    /// 数据库连接池
    pub db: SqlitePool,
    /// SSH 连接管理器
    pub ssh: SshManager,
    /// 已解锁的 Vault(运行时持有 data key;未解锁时为 None)
    vault: RwLock<Option<Arc<Vault>>>,
}

impl AppState {
    pub fn new(db: SqlitePool) -> Self {
        Self {
            db,
            ssh: SshManager::new(),
            vault: RwLock::new(None),
        }
    }

    /// 获取已解锁的 Vault(若未解锁则报错)— 同步版,适合无需等待的场景
    pub fn require_vault(&self) -> Result<Arc<Vault>, AppError> {
        self.vault
            .try_read()
            .ok()
            .and_then(|guard| guard.clone())
            .ok_or_else(|| AppError::Vault("凭证库未解锁,请先解锁".into()))
    }

    /// 获取已解锁的 Vault(若未解锁则报错)— async 版,确保拿到最新状态
    pub async fn require_vault_arc(&self) -> Result<Arc<Vault>, AppError> {
        self.vault
            .read()
            .await
            .clone()
            .ok_or_else(|| AppError::Vault("凭证库未解锁,请先解锁".into()))
    }

    pub async fn vault(&self) -> Option<Arc<Vault>> {
        self.vault.read().await.clone()
    }

    pub async fn set_vault(&self, vault: Vault) {
        *self.vault.write().await = Some(Arc::new(vault));
    }

    pub async fn clear_vault(&self) {
        *self.vault.write().await = None;
    }

    pub fn db(&self) -> &SqlitePool {
        &self.db
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 初始化日志
    let _ = env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("info"),
    )
    .try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // 确定 app data 目录
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("无法获取 app data 目录");

            log::info!("数据目录: {}", data_dir.display());

            // 在 Tokio runtime 里初始化数据库(同步 setup 中需要异步)
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                let db = match db::init_db(&data_dir).await {
                    Ok(db) => db,
                    Err(e) => {
                        log::error!("数据库初始化失败: {e}");
                        panic!("数据库初始化失败: {e}");
                    }
                };
                let state = AppState::new(db);
                handle.manage(state);
                // 终端会话管理器(单独 manage,供 terminal 命令使用)
                handle.manage(terminal::TerminalManagerHolder(std::sync::Arc::new(
                    terminal::TerminalManager::new(),
                )));
                log::info!("Witchcat Ops 后端启动完成");
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // vault
            commands::vault_is_initialized,
            commands::vault_setup,
            commands::vault_unlock,
            commands::vault_lock,
            commands::vault_is_unlocked,
            // servers
            commands::list_servers,
            commands::get_server,
            commands::create_server,
            commands::update_server,
            commands::delete_server,
            commands::connect_server,
            commands::confirm_host_key,
            commands::disconnect_server,
            commands::server_connection_status,
            commands::execute_command,
            // providers(LLM 配置)
            commands::list_providers,
            commands::get_provider,
            commands::create_provider,
            commands::update_provider,
            commands::delete_provider,
            // 终端流(交互式)
            terminal::terminal_open,
            terminal::terminal_input,
            terminal::terminal_resize,
            terminal::terminal_close,
            terminal::frontend_log,
            // audit
            commands::query_audit_logs,
            commands::get_session_audit_logs,
            commands::audit_stats,
            // skills
            commands::list_skills,
            commands::list_enabled_skills,
            commands::get_skill,
            commands::upsert_skill,
            commands::delete_skill,
            commands::toggle_skill,
            // quick actions
            commands::list_quick_actions,
            commands::upsert_quick_action,
            commands::delete_quick_action,
            // docs
            commands::list_docs,
            commands::get_doc,
            commands::upsert_doc,
            commands::update_doc_status,
            commands::delete_doc,
            commands::doc_to_skill,
            // SFTP 文件操作
            commands::sftp_list_dir,
            commands::sftp_read_file,
            commands::sftp_write_file,
            commands::sftp_delete_file,
            commands::sftp_mkdir,
            commands::sftp_rmdir,
            commands::sftp_rename,
            commands::sftp_stat,
            // 运维:监控 / 容器 / systemd
            commands::get_metrics,
            commands::list_containers,
            commands::control_container,
            commands::list_services,
            commands::control_service,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
