//! 交互式终端流
//!
//! 设计(actor 模式):
//! - 每个终端 = 一个 PTY channel + 一个 tokio task(读 channel 输出 → emit Tauri 事件)
//! - 前端输入/resize/close 通过 mpsc 通道发给 task
//! - task 退出时自动清理会话
//!
//! 事件流(后端 → 前端):
//!   `terminal_output_<id>`  : { data: string }  服务器输出(二进制安全,base64)
//!   `terminal_exit_<id>`    : { code: number }  会话结束
//!
//! 命令流(前端 → 后端):
//!   terminal_open    → 开 PTY,返回 terminal_id
//!   terminal_input   → 写入用户按键
//!   terminal_resize  → 改窗口大小
//!   terminal_close   → 关闭终端

use std::collections::HashMap;
use std::sync::Arc;
use base64::Engine;
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;

use crate::error::{AppError, AppResult};
use crate::executor::{log_action, AuditContext};
use crate::AppState;

/// 发给终端 task 的指令
enum TerminalCmd {
    /// 用户输入(原始字节)
    Input(Vec<u8>),
    /// 终端 resize
    Resize { cols: u32, rows: u32 },
    /// 关闭终端
    Close,
}

/// 一个活跃的终端会话
struct TerminalSession {
    /// 发送指令的通道
    tx: mpsc::UnboundedSender<TerminalCmd>,
    /// task 句柄(用于等待结束)
    _task: JoinHandle<()>,
    /// 会话令牌:task 退出清理时只删除与自己令牌一致的条目,
    /// 防止同 id 并发打开时旧 task 的清理误删新会话
    token: Arc<()>,
}

/// 终端会话管理器(存 AppState)
#[derive(Default)]
pub struct TerminalManager {
    /// terminal_id → 会话
    sessions: Mutex<HashMap<String, TerminalSession>>,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    /// 打开一个终端,返回 terminal_id
    pub async fn open(
        &self,
        app: AppHandle,
        ssh: &crate::ssh::SshManager,
        server_id: i64,
        cols: u32,
        rows: u32,
        terminal_id: Option<String>,
    ) -> AppResult<String> {
        // 前端可预生成 id(用于先建 xterm 再开 PTY,避免初始输出丢失)
        let terminal_id = terminal_id.unwrap_or_else(|| {
            format!("term_{}", uuid::Uuid::new_v4().simple())
        });

        // 防重复:id 已存在则报错,而不是覆盖会话表条目。
        // 覆盖会让旧 task 的退出清理把新会话的条目删掉,导致新终端失联。
        {
            let sessions = self.sessions.lock().await;
            if sessions.contains_key(&terminal_id) {
                return Err(AppError::InvalidInput(format!(
                    "终端 {terminal_id} 已存在,拒绝重复打开"
                )));
            }
        }

        // 查服务器 host(审计记录用):查不到只降级为空串并记日志,绝不阻断开终端
        let db = app.state::<AppState>().db.clone();
        let server_host = query_server_host(&db, server_id).await;

        // 开 PTY channel(所有权转移给 task)
        let channel = ssh.open_pty(server_id, cols, rows, "xterm-256color").await?;

        let (tx, mut rx) = mpsc::unbounded_channel::<TerminalCmd>();
        let id_for_task = terminal_id.clone();
        let app_for_task = app.clone();
        let token = Arc::new(());
        let token_for_task = token.clone();

        // 读 channel 输出 + 处理指令的 task
        let task = tokio::spawn(async move {
            run_terminal_loop(
                id_for_task,
                app_for_task,
                token_for_task,
                server_id,
                server_host,
                db,
                channel,
                &mut rx,
            )
            .await;
        });

        // 插入前在同一把锁内再次检查(覆盖并发打开同 id 的竞争);
        // 若期间被抢占,关闭刚开的 PTY task 并报错,绝不留孤儿覆盖条目
        {
            let mut sessions = self.sessions.lock().await;
            if sessions.contains_key(&terminal_id) {
                let _ = tx.send(TerminalCmd::Close);
                return Err(AppError::InvalidInput(format!(
                    "终端 {terminal_id} 已存在,拒绝重复打开"
                )));
            }
            sessions.insert(
                terminal_id.clone(),
                TerminalSession { tx, _task: task, token },
            );
        }

        log::info!("终端 {terminal_id} 已打开(server={server_id})");
        Ok(terminal_id)
    }

    /// 发送用户输入
    pub async fn input(&self, terminal_id: &str, data: Vec<u8>) -> AppResult<()> {
        let sessions = self.sessions.lock().await;
        let session = sessions
            .get(terminal_id)
            .ok_or_else(|| AppError::NotFound(format!("终端 {terminal_id}")))?;
        session
            .tx
            .send(TerminalCmd::Input(data))
            .map_err(|_| AppError::Internal("终端已关闭".into()))?;
        Ok(())
    }

    /// resize
    pub async fn resize(&self, terminal_id: &str, cols: u32, rows: u32) -> AppResult<()> {
        let sessions = self.sessions.lock().await;
        let session = sessions
            .get(terminal_id)
            .ok_or_else(|| AppError::NotFound(format!("终端 {terminal_id}")))?;
        session
            .tx
            .send(TerminalCmd::Resize { cols, rows })
            .map_err(|_| AppError::Internal("终端已关闭".into()))?;
        Ok(())
    }

    /// 关闭终端
    pub async fn close(&self, terminal_id: &str) -> AppResult<()> {
        let session = self.sessions.lock().await.remove(terminal_id);
        if let Some(session) = session {
            let _ = session.tx.send(TerminalCmd::Close);
            log::info!("终端 {terminal_id} 已关闭");
        }
        Ok(())
    }
}

/// 终端 task 的主循环
///
/// 同时处理:① channel 输出 → emit 给前端;② 前端指令(输入/resize/close)
/// 用户输入只观察不改动:原始字节原样转发给 SSH,同时逐字节整理行写审计。
async fn run_terminal_loop(
    terminal_id: String,
    app: AppHandle,
    token: Arc<()>,
    server_id: i64,
    server_host: String,
    db: SqlitePool,
    mut channel: russh::Channel<russh::client::Msg>,
    rx: &mut mpsc::UnboundedReceiver<TerminalCmd>,
) {
    use russh::ChannelMsg;

    let output_event = format!("terminal_output_{terminal_id}");
    let exit_event = format!("terminal_exit_{terminal_id}");
    let b64 = base64::engine::general_purpose::STANDARD;
    let mut data_chunks: u64 = 0;

    // 审计观察状态(每个会话独立;只观察,绝不改动转发给 SSH 的字节)
    let mut line_buf: Vec<u8> = Vec::new();
    let mut in_esc = false;
    let mut pending_cr = false;

    log::debug!("终端 {terminal_id} 事件循环已启动,等待 channel 数据");

    loop {
        tokio::select! {
            // 服务器输出 → emit 给前端
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { ref data }) => {
                        data_chunks += 1;
                        // 诊断:前 5 个 chunk 必记,之后每 50 个记一次(debug 级)
                        if data_chunks <= 5 || data_chunks % 50 == 0 {
                            log::debug!(
                                "终端 {terminal_id} 收到输出 chunk #{data_chunks} ({} 字节),已 emit",
                                data.len()
                            );
                        }
                        let encoded = b64.encode(data.as_ref());
                        let _ = app.emit(&output_event, serde_json::json!({ "data": encoded }));
                    }
                    Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                        // stderr 也发给前端(终端里合并显示)
                        let encoded = b64.encode(data.as_ref());
                        let _ = app.emit(&output_event, serde_json::json!({ "data": encoded }));
                    }
                    Some(ChannelMsg::ExitStatus { exit_status }) => {
                        let _ = app.emit(&exit_event, serde_json::json!({ "code": exit_status }));
                        break;
                    }
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                        log::info!("终端 {terminal_id} channel 已断开(Eof/Close/None),共收到 {data_chunks} 个输出 chunk");
                        let _ = app.emit(&exit_event, serde_json::json!({ "code": -1 }));
                        break;
                    }
                    _ => {}
                }
            }
            // 前端指令
            cmd = rx.recv() => {
                match cmd {
                    Some(TerminalCmd::Input(data)) => {
                        // channel.data 接受 AsyncRead,&[u8] 实现了它
                        // (原样转发,审计只是观察,不改动任何字节)
                        if channel.data(&data[..]).await.is_err() {
                            break;
                        }
                        // 审计观察:逐字节整理输入行,行结束时写审计
                        for &b in &data {
                            if let Some(line) = process_input_byte(
                                &mut line_buf,
                                b,
                                &mut in_esc,
                                &mut pending_cr,
                            ) {
                                audit_terminal_input(&db, server_id, &server_host, &line).await;
                            }
                        }
                    }
                    Some(TerminalCmd::Resize { cols, rows }) => {
                        let _ = channel.window_change(cols, rows, 0, 0).await;
                    }
                    Some(TerminalCmd::Close) | None => {
                        let _ = channel.close().await;
                        break;
                    }
                }
            }
        }
    }

    // 会话结束:写一条 terminal_close 审计(固定文案)。
    // 无论正常退出还是 channel 断开都会走到这里;与下方会话表清理互相独立
    let close_ctx = AuditContext {
        source: "manual_terminal".into(),
        session_id: None,
        tool_name: "terminal_close".into(),
        command: None,
        args: None,
        approved_by: None,
        proposal_id: None,
    };
    if let Err(e) = log_action(
        &db,
        Some(server_id),
        Some(&server_host),
        true,
        Some("终端会话已关闭"),
        &close_ctx,
    )
    .await
    {
        log::error!("终端关闭审计写入失败(server={server_id}): {e}");
    }

    // 清理:从会话表移除自己(task 结束说明 channel 已关)
    // 只删除与自身令牌一致的条目:并发打开同 id 时,旧 task 不得误删新会话的条目
    let id = terminal_id.clone();
    let app_clone = app.clone();
    tokio::spawn(async move {
        if let Some(tm) = app_clone.try_state::<TerminalManagerHolder>() {
            let mut sessions = tm.0.sessions.lock().await;
            let owns_entry = sessions
                .get(&id)
                .map(|s| Arc::ptr_eq(&s.token, &token))
                .unwrap_or(false);
            if owns_entry {
                sessions.remove(&id);
                log::debug!("终端 {id} 已从会话表移除");
            }
        }
    });

    log::debug!("终端 {terminal_id} 循环结束");
}

// ==================== 终端输入审计 ====================

/// 查询服务器 host(用于审计记录)。
///
/// 查不到(服务器已删除/库故障)只降级为空串并记日志,**绝不阻断开终端**。
async fn query_server_host(db: &SqlitePool, server_id: i64) -> String {
    use sqlx::Row;
    match sqlx::query("SELECT host FROM servers WHERE id = ?")
        .bind(server_id)
        .fetch_optional(db)
        .await
    {
        Ok(Some(row)) => row.try_get::<String, _>("host").unwrap_or_else(|e| {
            log::warn!("服务器 {server_id} host 字段解析失败,审计 host 置空: {e}");
            String::new()
        }),
        Ok(None) => {
            log::warn!("服务器 {server_id} 不存在,审计 host 置空");
            String::new()
        }
        Err(e) => {
            log::warn!("查询服务器 {server_id} host 失败,审计 host 置空: {e}");
            String::new()
        }
    }
}

/// 审计行截断上限(与 executor::OUTPUT_TRUNCATE 同一精神,防审计日志膨胀)
const AUDIT_LINE_CAP: usize = 2000;

/// 按字符边界截断审计行,避免切断多字节 UTF-8 字符
fn cap_audit_line(s: &str) -> String {
    if s.len() <= AUDIT_LINE_CAP {
        return s.to_string();
    }
    let mut end = AUDIT_LINE_CAP;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}...(输入已截断,共 {} 字符)", &s[..end], s.chars().count())
}

/// 写一条终端输入审计。
///
/// 隐私提示:这是按键级审计,用户在密码提示符(sudo / 数据库密码等)处键入的
/// 敏感内容同样会被记录 —— 这是"一切执行皆审计"的固有代价,属有意为之;
/// 此处不做脱敏(一旦脱敏,攻击者的输入同样会消失,审计即失效)。
async fn audit_terminal_input(db: &SqlitePool, server_id: i64, server_host: &str, line: &str) {
    let ctx = AuditContext {
        source: "manual_terminal".into(),
        session_id: None,
        tool_name: "terminal_input".into(),
        command: Some(cap_audit_line(line)),
        args: None,
        approved_by: None,
        proposal_id: None,
    };
    if let Err(e) = log_action(db, Some(server_id), Some(server_host), true, None, &ctx).await {
        log::error!("终端输入审计写入失败(server={server_id}): {e}");
    }
}

/// 逐字节处理终端输入,整理出审计用的命令行(纯函数,状态由调用方持有)。
///
/// - `buf`:当前行缓冲
/// - `in_esc`:正在吞 ESC 序列(箭头键等控制序列不污染审计行)
/// - `pending_cr`:`\r` 后紧跟 `\n` 时只结算一次(CRLF 不重复审计)
///
/// 返回 `Some(line)` 表示一行结束(已 trim;空行返回 `None`,调用方跳过审计)。
fn process_input_byte(
    buf: &mut Vec<u8>,
    b: u8,
    in_esc: &mut bool,
    pending_cr: &mut bool,
) -> Option<String> {
    // 行结束符优先级最高:即使正卡在残缺 ESC 序列里,也绝不吞掉换行导致漏审计
    if b == b'\n' || b == b'\r' {
        if b == b'\r' {
            *pending_cr = true;
        } else if *pending_cr {
            // \r\n:行已在上一个 \r 结算过,这里只清除标记
            *pending_cr = false;
            return None;
        }
        *in_esc = false; // 残缺的 ESC 序列随行结束作废
        let line = String::from_utf8_lossy(buf).into_owned();
        buf.clear();
        let line = line.trim().to_string();
        return if line.is_empty() { None } else { Some(line) };
    }

    // 任何非换行字节都会打断 \r\n 组合(如 "a\rb\n"),清除待判标记
    *pending_cr = false;

    // 正在吞 ESC 序列:直到终结字节(0x40..=0x7e)才结束
    if *in_esc {
        match b {
            // 引入符 CSI '['(0x5b) / SS3 'O'(0x4f):它们是序列开头,继续吞
            // (虽落在 0x40..=0x7e 区间,却是序列的一部分而非终结字节)
            0x4f | 0x5b => {}
            // 终结字节(方向键 A/B/C/D、~、普通字母等):序列结束
            0x40..=0x7e => *in_esc = false,
            // 参数/中间字节(数字、';' 等)与意外字节:继续吞
            _ => {}
        }
        return None;
    }

    match b {
        // 退格(BS)/删除(DEL):回退一个字节,让审计行反映用户实际输入
        0x08 | 0x7f => {
            buf.pop();
        }
        // ESC:进入转义序列状态
        0x1b => *in_esc = true,
        // 其余 C0 控制字符丢弃(0x09 TAB 保留,属正常输入)
        _ if matches!(b, 0x01..=0x08 | 0x0b..=0x0c | 0x0e..=0x1f) => {}
        _ => buf.push(b),
    }
    None
}

// ==================== Tauri 命令 ====================

/// TerminalManager 的包装(Tauri managed state 需要单独类型避免与 AppState 冲突)
pub struct TerminalManagerHolder(pub Arc<TerminalManager>);

/// 打开终端
#[tauri::command]
pub async fn terminal_open(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    tm: tauri::State<'_, TerminalManagerHolder>,
    server_id: i64,
    cols: Option<u32>,
    rows: Option<u32>,
    terminal_id: Option<String>,
) -> AppResult<String> {
    let cols = cols.unwrap_or(80);
    let rows = rows.unwrap_or(24);
    tm.0.open(app, &state.ssh, server_id, cols, rows, terminal_id).await
}

/// 用户输入
#[tauri::command]
pub async fn terminal_input(
    tm: tauri::State<'_, TerminalManagerHolder>,
    terminal_id: String,
    data: String, // base64 编码的字节
) -> AppResult<()> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|_| AppError::InvalidInput("base64 解码失败".into()))?;
    tm.0.input(&terminal_id, bytes).await
}

/// resize
#[tauri::command]
pub async fn terminal_resize(
    tm: tauri::State<'_, TerminalManagerHolder>,
    terminal_id: String,
    cols: u32,
    rows: u32,
) -> AppResult<()> {
    tm.0.resize(&terminal_id, cols, rows).await
}

/// 关闭终端
#[tauri::command]
pub async fn terminal_close(
    tm: tauri::State<'_, TerminalManagerHolder>,
    terminal_id: String,
) -> AppResult<()> {
    tm.0.close(&terminal_id).await
}

/// 前端诊断日志桥(前端关键节点打到后端日志,排查黑屏链路)
#[tauri::command]
pub fn frontend_log(msg: String) {
    log::info!("[JS] {msg}");
}

#[cfg(test)]
mod tests {
    use super::process_input_byte;

    /// 喂入字节流,收集所有结算出的行
    fn collect(bytes: &[u8]) -> Vec<String> {
        let mut buf = Vec::new();
        let mut in_esc = false;
        let mut pending_cr = false;
        let mut lines = Vec::new();
        for &b in bytes {
            if let Some(line) = process_input_byte(&mut buf, b, &mut in_esc, &mut pending_cr) {
                lines.push(line);
            }
        }
        lines
    }

    #[test]
    fn terminal_input_lf_finalizes_line() {
        assert_eq!(collect(b"ls -la\n"), vec!["ls -la"]);
        // 未结束的行不结算
        assert!(collect(b"echo hi").is_empty());
    }

    #[test]
    fn terminal_input_crlf_single_entry() {
        // \r\n 只审计一次,不重复
        assert_eq!(collect(b"pwd\r\n"), vec!["pwd"]);
    }

    #[test]
    fn terminal_input_bare_cr_finalizes() {
        assert_eq!(collect(b"whoami\r"), vec!["whoami"]);
        assert_eq!(collect(b"a\rb\n"), vec!["a", "b"]);
    }

    #[test]
    fn terminal_input_backspace_removes_last_byte() {
        // DEL(0x7f) 修正
        assert_eq!(collect(b"ls -laa\x7f\n"), vec!["ls -la"]);
        // BS(0x08) 修正
        assert_eq!(collect(b"cat\x08t /etc/hosts\n"), vec!["cat /etc/hosts"]);
    }

    #[test]
    fn terminal_input_ansi_sequences_stripped() {
        // CSI 上箭头 ESC [ A
        assert_eq!(collect(b"ls\x1b[A\n"), vec!["ls"]);
        // CSI 删除键 ESC [ 3 ~
        assert_eq!(collect(b"rm -rf\x1b[3~\n"), vec!["rm -rf"]);
        // VT100 方向键 ESC O A(SS3)
        assert_eq!(collect(b"ls\x1bOA\n"), vec!["ls"]);
    }

    #[test]
    fn terminal_input_control_chars_and_empty_lines_skipped() {
        // 空行不审计
        assert_eq!(collect(b"\n"), Vec::<String>::new());
        // C0 控制字符被丢弃
        assert_eq!(collect(b"\x01echo\x02 hi\x0c\n"), vec!["echo hi"]);
    }

    #[test]
    fn terminal_input_trim_and_tab_kept() {
        // 前后空白被 trim
        assert_eq!(collect(b"  cd /tmp  \n"), vec!["cd /tmp"]);
        // TAB 保留
        assert_eq!(collect(b"ls\t-la\n"), vec!["ls\t-la"]);
    }
}
