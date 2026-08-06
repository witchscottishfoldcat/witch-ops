//! LLM Provider 档案管理(前端配 API key 用)
//!
//! Agent 的 LLM 调用在前端,但 provider 配置(API key 等)存后端并加密。
//! 前端读取时,后端解密后返回明文 key(仅在本机内存,不上传任何地方)。

use tauri::State;

use crate::error::{AppError, AppResult};
use crate::models::{AgentProvider, ProviderInput};
use crate::AppState;

/// 列出所有 provider(api_key 返回解密后的明文,供前端使用)
#[tauri::command]
pub async fn list_providers(state: State<'_, AppState>) -> AppResult<Vec<AgentProvider>> {
    let vault = state.vault().await;
    let mut providers =
        sqlx::query_as::<_, AgentProvider>("SELECT * FROM agent_providers ORDER BY name")
            .fetch_all(state.db())
            .await?;

    // 若 vault 已解锁,解密 api_key 放到字段里供前端用
    // 注意:AgentProvider.api_key_enc 在 schema 是密文;
    // 这里约定:若已解锁,把解密后的明文放回该字段;否则返回掩码
    if let Some(vault) = vault {
        for p in providers.iter_mut() {
            if let Ok(plain) = vault.decrypt_str(&p.api_key_enc) {
                p.api_key_enc = plain;
            } else {
                p.api_key_enc = "***".into();
            }
        }
    } else {
        for p in providers.iter_mut() {
            p.api_key_enc = "***".into();
        }
    }
    Ok(providers)
}

/// 获取单个 provider(含解密后的 api_key)
#[tauri::command]
pub async fn get_provider(state: State<'_, AppState>, id: String) -> AppResult<AgentProvider> {
    let mut provider =
        sqlx::query_as::<_, AgentProvider>("SELECT * FROM agent_providers WHERE id = ?")
            .bind(&id)
            .fetch_optional(state.db())
            .await?
            .ok_or_else(|| AppError::NotFound(format!("provider {id}")))?;

    if let Some(vault) = state.vault().await {
        if let Ok(plain) = vault.decrypt_str(&provider.api_key_enc) {
            provider.api_key_enc = plain;
        } else {
            provider.api_key_enc = "***".into();
        }
    } else {
        provider.api_key_enc = "***".into();
    }
    Ok(provider)
}

/// 新建 provider
#[tauri::command]
pub async fn create_provider(
    state: State<'_, AppState>,
    input: ProviderInput,
) -> AppResult<String> {
    validate_provider_input(&input)?;

    let vault = state.require_vault_arc().await?;
    let api_key_enc = vault.encrypt_str(&input.api_key)?;
    let models_json = input
        .models
        .as_ref()
        .map(|m| serde_json::to_string(m).unwrap_or_default());

    let id = format!("prov_{}", uuid_str());
    sqlx::query(
        "INSERT INTO agent_providers (id, name, base_url, api_key_enc, default_model, models)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&input.name)
    .bind(&input.base_url)
    .bind(&api_key_enc)
    .bind(&input.default_model)
    .bind(&models_json)
    .execute(state.db())
    .await?;

    Ok(id)
}

/// 更新 provider
#[tauri::command]
pub async fn update_provider(
    state: State<'_, AppState>,
    id: String,
    input: ProviderInput,
) -> AppResult<()> {
    validate_provider_input(&input)?;

    let vault = state.require_vault_arc().await?;
    let api_key_enc = vault.encrypt_str(&input.api_key)?;
    let models_json = input
        .models
        .as_ref()
        .map(|m| serde_json::to_string(m).unwrap_or_default());

    sqlx::query(
        "UPDATE agent_providers SET name=?, base_url=?, api_key_enc=?, default_model=?, models=?,
         updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
    )
    .bind(&input.name)
    .bind(&input.base_url)
    .bind(&api_key_enc)
    .bind(&input.default_model)
    .bind(&models_json)
    .bind(&id)
    .execute(state.db())
    .await?;

    Ok(())
}

/// 删除 provider
#[tauri::command]
pub async fn delete_provider(state: State<'_, AppState>, id: String) -> AppResult<()> {
    sqlx::query("DELETE FROM agent_providers WHERE id = ?")
        .bind(&id)
        .execute(state.db())
        .await?;
    Ok(())
}

fn validate_provider_input(input: &ProviderInput) -> AppResult<()> {
    if input.name.trim().is_empty() {
        return Err(AppError::InvalidInput("名称不能为空".into()));
    }
    if input.base_url.trim().is_empty() {
        return Err(AppError::InvalidInput("base_url 不能为空".into()));
    }
    if input.api_key.trim().is_empty() {
        return Err(AppError::InvalidInput("api_key 不能为空".into()));
    }
    Ok(())
}

fn uuid_str() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}
