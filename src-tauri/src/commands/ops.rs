//! 运维命令:监控采集 / 容器管理 / systemd 服务管理
//!
//! 这些命令都走 SSH 在远程执行 shell 来采集数据或操作。
//! 注意:命令执行走统一执行出口(经审计),这里用 execute_command 命令的内部逻辑。
//! 为简化,监控类只读查询直接用 ssh.run_command(不走审计,因为只读);
//! 写操作(容器启停、服务管理)应走 execute_and_audit(留痕)。

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::AppResult;
use crate::executor::{execute_and_audit, AuditContext};
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

// ============================================================
// 监控采集(CPU / 内存 / 磁盘 / 网络 / 负载)
// ============================================================

/// 服务器实时指标
#[derive(Debug, Clone, Serialize)]
pub struct ServerMetrics {
    pub cpu_usage: f64,        // 百分比
    pub mem_total: u64,        // KB
    pub mem_used: u64,         // KB
    pub mem_available: u64,    // KB
    pub swap_total: u64,       // KB
    pub swap_used: u64,        // KB
    pub load_1: f64,
    pub load_5: f64,
    pub load_15: f64,
    pub uptime_seconds: u64,
    pub disks: Vec<DiskInfo>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiskInfo {
    pub filesystem: String,
    pub mount: String,
    pub total: u64,   // KB
    pub used: u64,    // KB
    pub avail: u64,   // KB
    pub usage_percent: f64,
}

/// 采集服务器指标(通过 SSH 读 /proc 和命令输出)
#[tauri::command]
pub async fn get_metrics(
    state: State<'_, AppState>,
    server_id: i64,
) -> AppResult<ServerMetrics> {
    // 一次性执行多条命令,合并解析(减少 SSH 往返)
    let script = r#"
echo '===CPU==='
top -bn1 | grep 'Cpu(s)' | head -1
echo '===MEM==='
free -k
echo '===LOAD==='
cat /proc/loadavg
echo '===UPTIME==='
cat /proc/uptime
echo '===DISK==='
df -kP
"#;
    let result = state.ssh.run_command(server_id, script).await?;
    parse_metrics(&result.stdout)
}

/// 解析监控输出
fn parse_metrics(output: &str) -> AppResult<ServerMetrics> {
    let mut cpu_usage = 0.0;
    let mut mem_total = 0;
    let mut mem_used = 0;
    let mut mem_available = 0;
    let mut swap_total = 0;
    let mut swap_used = 0;
    let mut load_1 = 0.0;
    let mut load_5 = 0.0;
    let mut load_15 = 0.0;
    let mut uptime_seconds = 0;
    let mut disks = Vec::new();

    let mut section = "";
    for line in output.lines() {
        let line = line.trim();
        if line.starts_with("===CPU===") {
            section = "cpu";
        } else if line.starts_with("===MEM===") {
            section = "mem";
        } else if line.starts_with("===LOAD===") {
            section = "load";
        } else if line.starts_with("===UPTIME===") {
            section = "uptime";
        } else if line.starts_with("===DISK===") {
            section = "disk";
        } else if !line.is_empty() {
            match section {
                "cpu" => {
                    // %Cpu(s):  5.0 us,  2.0 sy, ...
                    if let Some(us) = parse_cpu_line(line) {
                        cpu_usage = us;
                    }
                }
                "mem" => {
                    // Mem:   total used free shared buff/cache available
                    if line.starts_with("Mem:") {
                        let parts: Vec<&str> = line.split_whitespace().collect();
                        if parts.len() >= 7 {
                            mem_total = parts[1].parse().unwrap_or(0);
                            mem_used = parts[2].parse().unwrap_or(0);
                            mem_available = parts[6].parse().unwrap_or(0);
                        }
                    } else if line.starts_with("Swap:") {
                        let parts: Vec<&str> = line.split_whitespace().collect();
                        if parts.len() >= 4 {
                            swap_total = parts[1].parse().unwrap_or(0);
                            swap_used = parts[2].parse().unwrap_or(0);
                        }
                    }
                }
                "load" => {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 3 {
                        load_1 = parts[0].parse().unwrap_or(0.0);
                        load_5 = parts[1].parse().unwrap_or(0.0);
                        load_15 = parts[2].parse().unwrap_or(0.0);
                    }
                }
                "uptime" => {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if let Some(s) = parts.first() {
                        uptime_seconds = s.split('.').next().unwrap_or("0").parse().unwrap_or(0);
                    }
                }
                "disk" => {
                    // Filesystem 1024-blocks Used Available Capacity Mounted on
                    if !line.starts_with("Filesystem") {
                        let parts: Vec<&str> = line.split_whitespace().collect();
                        if parts.len() >= 6 {
                            let total: u64 = parts[1].parse().unwrap_or(0);
                            let used: u64 = parts[2].parse().unwrap_or(0);
                            let avail: u64 = parts[3].parse().unwrap_or(0);
                            let usage = if total > 0 {
                                used as f64 / total as f64 * 100.0
                            } else {
                                0.0
                            };
                            let mount = parts[5..].join(" ");
                            disks.push(DiskInfo {
                                filesystem: parts[0].to_string(),
                                mount,
                                total,
                                used,
                                avail,
                                usage_percent: usage,
                            });
                        }
                    }
                }
                _ => {}
            }
        }
    }

    Ok(ServerMetrics {
        cpu_usage,
        mem_total,
        mem_used,
        mem_available,
        swap_total,
        swap_used,
        load_1,
        load_5,
        load_15,
        uptime_seconds,
        disks,
    })
}

fn parse_cpu_line(line: &str) -> Option<f64> {
    // "  %Cpu(s):  5.0 us,  2.0 sy, 93.0 id, ..."
    // 取 id(空闲),100-id 即使用率
    let parts: Vec<&str> = line.split(',').collect();
    for p in parts {
        let p = p.trim();
        if p.ends_with("id") {
            let num_str = p.trim_end_matches("id").trim();
            let idle: f64 = num_str.parse().ok()?;
            return Some((100.0 - idle).max(0.0));
        }
    }
    None
}

// ============================================================
// 容器管理(Docker / Podman,走 CLI)
// ============================================================

/// 容器信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContainerInfo {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
    pub state: String,
    pub runtime: String, // docker / podman
}

/// 列出容器(自动检测 docker 或 podman)
#[tauri::command]
pub async fn list_containers(
    state: State<'_, AppState>,
    server_id: i64,
    runtime: Option<String>, // "docker" | "podman",默认自动检测
) -> AppResult<Vec<ContainerInfo>> {
    let rt = runtime.unwrap_or_else(|| "docker".to_string());
    let cmd = format!(
        "{rt} ps -a --format '{{{{.ID}}}}|{{{{.Names}}}}|{{{{.Image}}}}|{{{{.Status}}}}|{{{{.State}}}}'"
    );
    let result = state.ssh.run_command(server_id, &cmd).await?;
    let mut containers = Vec::new();
    for line in result.stdout.lines() {
        let parts: Vec<&str> = line.split('|').collect();
        if parts.len() >= 5 {
            containers.push(ContainerInfo {
                id: parts[0].to_string(),
                name: parts[1].to_string(),
                image: parts[2].to_string(),
                status: parts[3].to_string(),
                state: parts[4].to_string(),
                runtime: rt.clone(),
            });
        }
    }
    Ok(containers)
}

/// 容器操作:容器级写操作走审计
#[derive(Debug, Deserialize)]
pub struct ContainerAction {
    pub container_id: String,
    pub action: String, // start/stop/restart/remove
    #[serde(default)]
    pub session_id: Option<String>,
}

#[tauri::command]
pub async fn control_container(
    state: State<'_, AppState>,
    server_id: i64,
    action: ContainerAction,
) -> AppResult<serde_json::Value> {
    let server_host = fetch_server_host(&state, server_id).await;
    let cmd = format!("docker {} {}", action.action, action.container_id);
    let ctx = AuditContext {
        source: "manual_terminal".into(),
        session_id: action.session_id,
        tool_name: format!("container_{}", action.action),
        command: Some(cmd.clone()),
        args: Some(format!(
            "{{\"container\":\"{}\"}}",
            action.container_id
        )),
        approved_by: Some("user".into()),
        proposal_id: None,
    };
    let (result, audit_id) =
        execute_and_audit(&state.ssh, state.db(), server_id, &server_host, &cmd, &ctx).await?;
    Ok(serde_json::json!({
        "audit_id": audit_id,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "exit_code": result.exit_code,
        "success": result.success(),
    }))
}

// ============================================================
// systemd 服务管理
// ============================================================

/// 服务信息
#[derive(Debug, Clone, Serialize)]
pub struct ServiceInfo {
    pub name: String,
    pub load_state: String,
    pub active_state: String,
    pub sub_state: String,
    pub description: String,
}

/// 列出 systemd 服务
#[tauri::command]
pub async fn list_services(
    state: State<'_, AppState>,
    server_id: i64,
) -> AppResult<Vec<ServiceInfo>> {
    let cmd = "systemctl list-units --type=service --all --no-legend --no-pager | awk '{print $1,$2,$3,$4; $1=$2=$3=$4=\"\"; print substr($0,9)}'";
    let result = state.ssh.run_command(server_id, cmd).await?;
    let mut services = Vec::new();
    let mut lines = result.stdout.lines();
    while let (Some(line1), Some(line2)) = (lines.next(), lines.next()) {
        let parts: Vec<&str> = line1.split_whitespace().collect();
        let desc = line2.trim();
        if parts.len() >= 4 {
            services.push(ServiceInfo {
                name: parts[0].to_string(),
                load_state: parts[1].to_string(),
                active_state: parts[2].to_string(),
                sub_state: parts[3].to_string(),
                description: desc.to_string(),
            });
        }
    }
    Ok(services)
}

/// 服务操作(start/stop/restart/enable/disable),走审计
#[tauri::command]
pub async fn control_service(
    state: State<'_, AppState>,
    server_id: i64,
    service_name: String,
    action: String, // start/stop/restart/enable/disable/status
    session_id: Option<String>,
) -> AppResult<serde_json::Value> {
    let server_host = fetch_server_host(&state, server_id).await;
    let cmd = format!("systemctl {} {}", action, service_name);
    let ctx = AuditContext {
        source: "manual_terminal".into(),
        session_id,
        tool_name: format!("service_{}", action),
        command: Some(cmd.clone()),
        args: Some(format!("{{\"service\":\"{service_name}\"}}")),
        approved_by: Some("user".into()),
        proposal_id: None,
    };
    let (result, audit_id) =
        execute_and_audit(&state.ssh, state.db(), server_id, &server_host, &cmd, &ctx).await?;
    Ok(serde_json::json!({
        "audit_id": audit_id,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "exit_code": result.exit_code,
        "success": result.success(),
    }))
}
