//! Agent LLM 调用代理(后端直连 provider,key 永不出后端)
//!
//! 安全契约:API key 由后端 `open_secret` 解密后仅在内存中使用,
//! 前端拿不到明文;LLM 的 HTTP 请求、SSE 解析都在后端完成,
//! 流式结果通过 `tauri::ipc::Channel<ChatEvent>` 以类型化事件推回前端。
//!
//! 取消机制:模块级 `ACTIVE_REQUESTS` 注册表存 request_id → 取消标志。
//! 前端调用 `agent_chat_cancel` 置位;流循环在每次读 chunk 之间检查标志,
//! 置位则跳出循环并 drop 响应流(reqwest 随 drop 断开连接),不发 Done 事件
//! (前端取消时已自行结算部分结果)。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::models::AgentProvider;
use crate::AppState;

/// 整流的僵尸防护时长(流式 600s 无进展则中止)
const STREAM_TIMEOUT: Duration = Duration::from_secs(600);

/// 前端发起的 LLM 调用请求
#[derive(Debug, Deserialize)]
pub struct ChatRequest {
    /// 前端生成的唯一 id,用于取消
    pub request_id: String,
    pub provider_id: String,
    pub model: String,
    /// 前端构建好的完整消息数组(含 system prompt)
    pub messages: Vec<serde_json::Value>,
    #[serde(default)]
    pub temperature: Option<f64>,
    /// TOOLS 数组(前端传入,与现状一致)
    pub tools: serde_json::Value,
}

/// 后端 → 前端的类型化流事件
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChatEvent {
    /// 累计正文(与前端 onText(text) 语义一致)
    Text { text: String },
    /// 累计 reasoning(与现有 turn.reasoning 语义一致)
    Reasoning { text: String },
    /// 流结束,携带完整 turn
    Done { turn: AgentTurnPayload },
    /// 出错(网络 / HTTP 状态 / API error)
    Error { message: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentTurnPayload {
    pub text: Option<String>,
    pub reasoning: Option<String>,
    pub tool_calls: Vec<ToolCallPayload>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolCallPayload {
    /// 格式 call_<unix_ms>_<i>,与现前端一致
    pub id: String,
    pub name: String,
    /// 解析失败时 {}
    pub arguments: serde_json::Value,
}

/// 活跃请求注册表:request_id → 取消标志。
/// 注意:std Mutex 不得跨 await 持有 —— 只在短临界区内取/放,flag 本身用 Arc 克隆出临界区。
static ACTIVE_REQUESTS: LazyLock<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// 发起 LLM 流式调用。命令立即返回,HTTP 工作由后台任务完成。
#[tauri::command]
pub async fn agent_chat(
    state: State<'_, AppState>,
    request: ChatRequest,
    out: tauri::ipc::Channel<ChatEvent>,
) -> AppResult<()> {
    let provider =
        sqlx::query_as::<_, AgentProvider>("SELECT * FROM agent_providers WHERE id = ?")
            .bind(&request.provider_id)
            .fetch_optional(state.db())
            .await?
            .ok_or_else(|| AppError::NotFound(format!("provider {}", request.provider_id)))?;

    // 后端解密 api_key(绝不落日志;失败时把错误经事件流送回前端)
    let api_key = match state.open_secret(&provider.api_key_enc).await {
        Ok(key) => key,
        Err(e) => {
            let _ = out.send(ChatEvent::Error {
                message: format!("Provider API key 解密失败: {e}"),
            });
            return Err(e);
        }
    };

    let cancel = Arc::new(AtomicBool::new(false));
    ACTIVE_REQUESTS
        .lock()
        .unwrap()
        .insert(request.request_id.clone(), cancel.clone());

    let request_id = request.request_id.clone();
    let task_cancel = cancel.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = run_chat(request, provider, api_key, out, task_cancel).await {
            log::error!("agent_chat [{request_id}] 任务失败: {e}");
        }
        // 任务结束(含取消/出错):移除注册表条目
        ACTIVE_REQUESTS.lock().unwrap().remove(&request_id);
    });

    Ok(())
}

/// 取消指定 request 的流(置位标志;流循环发现后断开连接)
#[tauri::command]
pub fn agent_chat_cancel(request_id: String) -> AppResult<()> {
    if let Some(flag) = ACTIVE_REQUESTS.lock().unwrap().get(&request_id) {
        flag.store(true, Ordering::SeqCst);
    }
    Ok(())
}

/// 流式解析的累积状态
#[derive(Default)]
struct StreamState {
    text: String,
    reasoning: String,
    /// 按 tool_calls[].index 累积(name / arguments 分片拼接),保持首次出现顺序
    tool_calls: Vec<ToolCallAcc>,
}

#[derive(Default, Clone)]
struct ToolCallAcc {
    name: Option<String>,
    arguments: Option<String>,
}

/// 单条 SSE data 载荷解析出的增量
#[derive(Debug, Default)]
struct DeltaPatch {
    content: Option<String>,
    reasoning: Option<String>,
    /// (index, function.name?, function.arguments 分片?)
    tool_calls: Vec<(usize, Option<String>, Option<String>)>,
}

/// 解析一条 `data:` 载荷。
/// - `Ok(Some(patch))`:正常增量
/// - `Ok(None)`:无增量([DONE]/非法 JSON/无 choices —— 忽略,与前端一致)
/// - `Err(msg)`:API 层错误(json.error)
fn parse_delta(data: &str) -> Result<Option<DeltaPatch>, String> {
    let json: serde_json::Value = match serde_json::from_str(data) {
        Ok(v) => v,
        // 忽略单条解析错误(与前端一致)
        Err(_) => return Ok(None),
    };

    if let Some(err) = json.get("error") {
        let msg = err
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("LLM 错误")
            .to_string();
        return Err(msg);
    }

    let Some(delta) = json.pointer("/choices/0/delta") else {
        return Ok(None);
    };

    let content = delta
        .get("content")
        .and_then(|c| c.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from);
    let reasoning = delta
        .get("reasoning_content")
        .and_then(|c| c.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from);
    let tool_calls = delta
        .get("tool_calls")
        .and_then(|t| t.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|tc| {
                    let idx = tc.get("index").and_then(|i| i.as_u64())? as usize;
                    let name = tc
                        .pointer("/function/name")
                        .and_then(|n| n.as_str())
                        .filter(|s| !s.is_empty())
                        .map(String::from);
                    let args = tc
                        .pointer("/function/arguments")
                        .and_then(|a| a.as_str())
                        .filter(|s| !s.is_empty())
                        .map(String::from);
                    Some((idx, name, args))
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(Some(DeltaPatch {
        content,
        reasoning,
        tool_calls,
    }))
}

/// 把一条 data 行应用到累积状态(与前端 streamChat 的 delta 处理一致)
fn apply_delta(state: &mut StreamState, patch: DeltaPatch) {
    if let Some(content) = patch.content {
        state.text.push_str(&content);
    }
    if let Some(reasoning) = patch.reasoning {
        state.reasoning.push_str(&reasoning);
    }
    for (idx, name, args) in patch.tool_calls {
        while state.tool_calls.len() <= idx {
            state.tool_calls.push(ToolCallAcc::default());
        }
        let acc = &mut state.tool_calls[idx];
        if let Some(name) = name {
            acc.name = Some(name);
        }
        if let Some(args) = args {
            acc.arguments = Some(format!("{}{}", acc.arguments.as_deref().unwrap_or(""), args));
        }
    }
}

fn http_err(e: reqwest::Error) -> AppError {
    AppError::Internal(e.to_string())
}

fn unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

/// HTTP + SSE 主流程(在后台任务中运行)。
/// 出错路径均已通过 Channel 发送 Error 事件,这里返回 Err 只用于日志。
async fn run_chat(
    request: ChatRequest,
    provider: AgentProvider,
    api_key: String,
    out: tauri::ipc::Channel<ChatEvent>,
    cancel: Arc<AtomicBool>,
) -> AppResult<()> {
    let url = format!("{}/chat/completions", provider.base_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": request.model,
        "stream": true,
        "temperature": request.temperature.unwrap_or(0.2),
        "tools": request.tools,
        "messages": request.messages,
    });

    let client = reqwest::Client::builder().build().map_err(http_err)?;

    // 600s 僵尸防护:整个流包一层超时
    let streamed = tokio::time::timeout(STREAM_TIMEOUT, async {
        let resp = client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {api_key}"))
            .json(&body)
            .send()
            .await
            .map_err(http_err)?;

        let status = resp.status();
        if !status.is_success() {
            let err_body = resp.text().await.unwrap_or_default();
            let msg = format!("LLM API 错误 {status}: {err_body}");
            let _ = out.send(ChatEvent::Error { message: msg.clone() });
            return Err(AppError::Internal(msg));
        }

        let mut stream = resp.bytes_stream();
        let mut state = StreamState::default();
        // 行缓冲(字节级累积,完整行才解码,处理 chunk 切断多字节字符)
        let mut buf: Vec<u8> = Vec::new();

        loop {
            // 取消检查:置于每次读之间;置位则跳出并 drop 流(断开连接)
            if cancel.load(Ordering::SeqCst) {
                return Ok(state);
            }
            let chunk = match stream.next().await {
                Some(Ok(c)) => c,
                Some(Err(e)) => {
                    let msg = format!("LLM 响应流读取失败: {e}");
                    let _ = out.send(ChatEvent::Error { message: msg.clone() });
                    return Err(AppError::Internal(msg));
                }
                None => break,
            };
            if cancel.load(Ordering::SeqCst) {
                return Ok(state);
            }

            buf.extend_from_slice(&chunk);
            while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
                let line_bytes: Vec<u8> = buf.drain(..=pos).collect();
                let line = String::from_utf8_lossy(&line_bytes[..line_bytes.len() - 1]);
                let line = line.trim_end_matches('\r');

                let Some(data) = line.strip_prefix("data:") else {
                    continue;
                };
                let data = data.trim();
                if data.is_empty() {
                    continue;
                }
                if data == "[DONE]" {
                    // 服务端结束信号:直接收尾(等价于等流 EOF)
                    return Ok(state);
                }

                match parse_delta(data) {
                    Ok(Some(patch)) => {
                        let has_content = patch.content.is_some();
                        let has_reasoning = patch.reasoning.is_some();
                        apply_delta(&mut state, patch);
                        // 只在对应字段有增量时发事件(与前端 truthy 判断一致)
                        if has_content {
                            let _ = out.send(ChatEvent::Text {
                                text: state.text.clone(),
                            });
                        }
                        if has_reasoning {
                            let _ = out.send(ChatEvent::Reasoning {
                                text: state.reasoning.clone(),
                            });
                        }
                    }
                    Ok(None) => {}
                    Err(msg) => {
                        let _ = out.send(ChatEvent::Error { message: msg.clone() });
                        return Err(AppError::Internal(msg));
                    }
                }
            }
        }

        // 流结束但缓冲里还有残余行(服务端未以换行结尾的兜底,前端会丢,这里补齐)
        let tail = String::from_utf8_lossy(&buf);
        let tail = tail.trim();
        if let Some(data) = tail.strip_prefix("data:") {
            let data = data.trim();
            if !data.is_empty() && data != "[DONE]" {
                match parse_delta(data) {
                    Ok(Some(patch)) => {
                        let has_content = patch.content.is_some();
                        let has_reasoning = patch.reasoning.is_some();
                        apply_delta(&mut state, patch);
                        // 只在对应字段有增量时发事件(与前端 truthy 判断一致)
                        if has_content {
                            let _ = out.send(ChatEvent::Text {
                                text: state.text.clone(),
                            });
                        }
                        if has_reasoning {
                            let _ = out.send(ChatEvent::Reasoning {
                                text: state.reasoning.clone(),
                            });
                        }
                    }
                    Ok(None) => {}
                    Err(msg) => {
                        let _ = out.send(ChatEvent::Error { message: msg.clone() });
                        return Err(AppError::Internal(msg));
                    }
                }
            }
        }

        Ok(state)
    })
    .await;

    let state = match streamed {
        Ok(Ok(state)) => state,
        Ok(Err(e)) => return Err(e), // 错误事件已在内部发送
        Err(_) => {
            let msg = "LLM 请求超时(600 秒)已中止".to_string();
            let _ = out.send(ChatEvent::Error { message: msg.clone() });
            return Err(AppError::Internal(msg));
        }
    };

    // 已取消:不发 Done(前端已自行结算部分结果)
    if cancel.load(Ordering::SeqCst) {
        return Ok(());
    }

    // 防御:LLM 返回的 tool_call arguments 可能不是合法 JSON,解析失败视为空参数
    let now_ms = unix_ms();
    let tool_calls: Vec<ToolCallPayload> = state
        .tool_calls
        .into_iter()
        .enumerate()
        .map(|(i, acc)| ToolCallPayload {
            id: format!("call_{now_ms}_{i}"),
            name: acc.name.unwrap_or_else(|| "unknown".into()),
            arguments: match acc.arguments {
                Some(s) => serde_json::from_str(&s).unwrap_or_else(|_| serde_json::Value::Object(Default::default())),
                None => serde_json::Value::Object(Default::default()),
            },
        })
        .collect();

    let turn = AgentTurnPayload {
        text: (!state.text.is_empty()).then_some(state.text),
        reasoning: (!state.reasoning.is_empty()).then_some(state.reasoning),
        tool_calls,
    };
    let _ = out.send(ChatEvent::Done { turn });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_content_delta() {
        let patch = parse_delta(r#"{"choices":[{"delta":{"content":"你好"}}]}"#)
            .unwrap()
            .unwrap();
        assert_eq!(patch.content.as_deref(), Some("你好"));
        assert!(patch.reasoning.is_none());
        assert!(patch.tool_calls.is_empty());
    }

    #[test]
    fn parse_reasoning_and_empty_content_ignored() {
        let patch = parse_delta(
            r#"{"choices":[{"delta":{"content":"","reasoning_content":"思考中"}}]}"#,
        )
        .unwrap()
        .unwrap();
        // 空 content 不产生增量(与前端 truthy 判断一致)
        assert!(patch.content.is_none());
        assert_eq!(patch.reasoning.as_deref(), Some("思考中"));
    }

    #[test]
    fn parse_invalid_json_is_ignored() {
        assert!(parse_delta("not-json").unwrap().is_none());
    }

    #[test]
    fn parse_done_marker_and_no_choices() {
        assert!(parse_delta("[DONE]").unwrap().is_none());
        assert!(parse_delta(r#"{"choices":[]}"#).unwrap().is_none());
    }

    #[test]
    fn parse_api_error_returns_err() {
        let err = parse_delta(r#"{"error":{"message":"rate limited"}}"#).unwrap_err();
        assert_eq!(err, "rate limited");
    }

    #[test]
    fn parse_tool_call_fragments() {
        let p1 = parse_delta(
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"run_command","arguments":""}}]}}]}"#,
        )
        .unwrap()
        .unwrap();
        assert_eq!(p1.tool_calls, vec![(0, Some("run_command".into()), None)]);
    }

    #[test]
    fn tool_call_accumulation_concatenates_arguments() {
        let mut state = StreamState::default();
        apply_delta(
            &mut state,
            DeltaPatch {
                tool_calls: vec![(0, Some("run_command".into()), Some(r#"{"cmd""#.into()))],
                ..Default::default()
            },
        );
        apply_delta(
            &mut state,
            DeltaPatch {
                tool_calls: vec![(0, None, Some(r#":"ls"}"#.into()))],
                ..Default::default()
            },
        );
        assert_eq!(state.tool_calls[0].name.as_deref(), Some("run_command"));
        assert_eq!(
            state.tool_calls[0].arguments.as_deref(),
            Some(r#"{"cmd":"ls"}"#)
        );
    }
}
