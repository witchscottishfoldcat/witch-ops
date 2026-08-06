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
    Ok(())
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
