//! Vault(凭证库)相关 IPC 命令

use tauri::State;

use crate::error::AppResult;
use crate::AppState;
use crate::vault::Vault;

/// 检查 Vault 是否已初始化
#[tauri::command]
pub async fn vault_is_initialized(state: State<'_, AppState>) -> AppResult<bool> {
    Vault::is_initialized(state.db()).await
}

/// 初始化 Vault(设置主密码)。首次使用时调用。
/// 启用后自动把此前明文存储的凭证全部加密(plain: → enc:v1:)。
#[tauri::command]
pub async fn vault_setup(
    state: State<'_, AppState>,
    master_password: String,
) -> AppResult<()> {
    if Vault::is_initialized(state.db()).await? {
        return Err(crate::error::AppError::InvalidInput(
            "Vault 已初始化,请用 unlock 解锁".into(),
        ));
    }
    let vault = Vault::setup(&master_password, state.db()).await?;
    state.set_vault(vault).await;

    // 迁移:启用前以明文存的凭证 → 加密
    migrate_plaintext_secrets(&state).await;

    Ok(())
}

/// 把各表里的 plain: 前缀敏感值重新加密为 enc:v1:
async fn migrate_plaintext_secrets(state: &AppState) {
    use sqlx::Row;
    let vault = match state.vault().await {
        Some(v) => v,
        None => return,
    };

    // (表名, 主键列, 敏感列, 主键是否字符串)
    //
    // 覆盖所有走 seal_secret/open_secret 同一套前缀格式(plain:/enc:v1:)的敏感列。
    // saved_credentials.secret_enc 与 mcp_servers.env_enc 目前后端尚无写入点,
    // 但 vault::reset_all 将其作为密文列一并清空、schema 注释也标注为整体加密,
    // 格式与上面两列一致,一并纳入迁移以覆盖历史数据。
    let targets: [(&str, &str, &str, bool); 4] = [
        ("servers", "id", "credential_enc", false),
        ("agent_providers", "id", "api_key_enc", true),
        ("saved_credentials", "id", "secret_enc", false),
        ("mcp_servers", "id", "env_enc", true),
    ];

    for (table, pk, col, pk_is_str) in targets {
        let sql = format!("SELECT {pk}, {col} FROM {table} WHERE {col} LIKE 'plain:%'");
        let rows = match sqlx::query(&sql).fetch_all(state.db()).await {
            Ok(r) => r,
            Err(e) => {
                log::warn!("迁移明文凭证:查询 {table} 失败: {e}");
                continue;
            }
        };
        let mut migrated = 0u32;
        for row in rows {
            let stored: String = match row.try_get(col) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let plain = match stored.strip_prefix(crate::PLAIN_PREFIX) {
                Some(p) => p,
                None => continue,
            };
            let enc = match vault.encrypt_str(plain) {
                Ok(e) => format!("{}{}", crate::ENC_PREFIX, e),
                Err(_) => continue,
            };
            let update = format!("UPDATE {table} SET {col} = ? WHERE {pk} = ?");
            let result = if pk_is_str {
                let id: String = row.try_get(pk).unwrap_or_default();
                sqlx::query(&update).bind(&enc).bind(id).execute(state.db()).await
            } else {
                let id: i64 = row.try_get(pk).unwrap_or_default();
                sqlx::query(&update).bind(&enc).bind(id).execute(state.db()).await
            };
            if result.is_ok() {
                migrated += 1;
            }
        }
        if migrated > 0 {
            log::info!("Vault 启用迁移:{table}.{col} 加密了 {migrated} 条明文凭证");
        }
    }
}

/// 解锁 Vault
#[tauri::command]
pub async fn vault_unlock(
    state: State<'_, AppState>,
    master_password: String,
) -> AppResult<()> {
    if state.vault().await.is_some() {
        return Ok(()); // 已解锁
    }
    let vault = Vault::unlock(&master_password, state.db()).await?;
    state.set_vault(vault).await;
    Ok(())
}

/// 锁定 Vault(清除内存中的 data key)
#[tauri::command]
pub async fn vault_lock(state: State<'_, AppState>) -> AppResult<()> {
    state.clear_vault().await;
    Ok(())
}

/// 检查 Vault 是否已解锁(在内存中持有 data key)
#[tauri::command]
pub async fn vault_is_unlocked(state: State<'_, AppState>) -> AppResult<bool> {
    Ok(state.vault().await.is_some())
}

/// 忘记密码:用本机钥匙串备份的 data key 重设主密码(凭证全保留)
#[tauri::command]
pub async fn vault_recover(
    state: State<'_, AppState>,
    new_password: String,
) -> AppResult<()> {
    let vault = Vault::recover_with_keychain(&new_password, state.db()).await?;
    state.set_vault(vault).await;
    Ok(())
}

/// 彻底重置 Vault(清空所有已存凭证,不可恢复)
#[tauri::command]
pub async fn vault_reset(state: State<'_, AppState>) -> AppResult<()> {
    Vault::reset_all(state.db()).await?;
    state.clear_vault().await;
    Ok(())
}
