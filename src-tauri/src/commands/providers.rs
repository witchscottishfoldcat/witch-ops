//! LLM Provider 档案管理(前端配 API key 用)
//!
//! 安全契约:API key 永不出后端。前端拿到的是 ProviderSummary
//! (api_key_enc 恒为掩码 "***" + has_key 标记);
//! 真正的 LLM 调用由 `agent_chat` 命令在后端解密 key 后代理发出。

use tauri::State;

use crate::error::{AppError, AppResult};
use crate::models::{AgentProvider, ProviderInput, ProviderSummary};
use crate::AppState;

/// 列出所有 provider(api_key 恒为掩码,前端拿不到明文)
#[tauri::command]
pub async fn list_providers(state: State<'_, AppState>) -> AppResult<Vec<ProviderSummary>> {
    let providers =
        sqlx::query_as::<_, AgentProvider>("SELECT * FROM agent_providers ORDER BY name")
            .fetch_all(state.db())
            .await?;

    Ok(providers.iter().map(|p| p.summary()).collect())
}

/// 获取单个 provider(api_key 恒为掩码)
#[tauri::command]
pub async fn get_provider(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<ProviderSummary> {
    let provider =
        sqlx::query_as::<_, AgentProvider>("SELECT * FROM agent_providers WHERE id = ?")
            .bind(&id)
            .fetch_optional(state.db())
            .await?
            .ok_or_else(|| AppError::NotFound(format!("provider {id}")))?;

    Ok(provider.summary())
}

/// 新建 provider
#[tauri::command]
pub async fn create_provider(
    state: State<'_, AppState>,
    input: ProviderInput,
) -> AppResult<String> {
    validate_provider_input(&input, true)?;

    let api_key_enc = state.seal_secret(&input.api_key).await?;
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
///
/// api_key 留空表示"保持不变"(与 servers.rs 的 COALESCE 模式一致):
/// 空串 → 传 NULL,由 COALESCE 保留库中原值;非空 → 重新加密后覆盖。
#[tauri::command]
pub async fn update_provider(
    state: State<'_, AppState>,
    id: String,
    input: ProviderInput,
) -> AppResult<()> {
    validate_provider_input(&input, false)?;

    let api_key_enc = if input.api_key.trim().is_empty() {
        None
    } else {
        Some(state.seal_secret(&input.api_key).await?)
    };
    let models_json = input
        .models
        .as_ref()
        .map(|m| serde_json::to_string(m).unwrap_or_default());

    sqlx::query(
        "UPDATE agent_providers SET name=?, base_url=?, api_key_enc=COALESCE(?, api_key_enc),
         default_model=?, models=?,
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

/// 校验 provider 输入。`require_key` = true 时(新建)要求非空 api_key;
/// 更新时允许留空(保持原 key)。
fn validate_provider_input(input: &ProviderInput, require_key: bool) -> AppResult<()> {
    if input.name.trim().is_empty() {
        return Err(AppError::InvalidInput("名称不能为空".into()));
    }
    if input.base_url.trim().is_empty() {
        return Err(AppError::InvalidInput("base_url 不能为空".into()));
    }
    if require_key && input.api_key.trim().is_empty() {
        return Err(AppError::InvalidInput("api_key 不能为空".into()));
    }
    Ok(())
}

fn uuid_str() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}
