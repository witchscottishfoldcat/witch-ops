// Witchcat Ops IPC 封装层 —— 类型安全的 invoke 封装
// 所有后端命令在这里统一封装,组件不直接调 invoke。
// 契约来源:docs/BACKEND_API.md

import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import type {
  Server, ServerInput, AuditLog, AuditFilter, Skill, QuickAction, Doc,
  Provider, ProviderInput, Container, ContainerAction, Service, ServerMetrics,
  DirEntry, AuditContext, ExecuteResult,
} from '../types/backend';

// ============ 凭证库 ============
export const vaultIsInitialized = () => invoke<boolean>('vault_is_initialized');
export const vaultSetup = (masterPassword: string) =>
  invoke<void>('vault_setup', { masterPassword });
export const vaultUnlock = (masterPassword: string) =>
  invoke<void>('vault_unlock', { masterPassword });
export const vaultLock = () => invoke<void>('vault_lock');
export const vaultIsUnlocked = () => invoke<boolean>('vault_is_unlocked');
/** 忘记密码:用本机钥匙串备份重设主密码(凭证全保留) */
export const vaultRecover = (newPassword: string) =>
  invoke<void>('vault_recover', { newPassword });
/** 彻底重置 Vault(清空所有已存凭证,不可恢复) */
export const vaultReset = () => invoke<void>('vault_reset');

// ============ 服务器 ============
export const listServers = () => invoke<Server[]>('list_servers');
export const getServer = (id: number) => invoke<Server>('get_server', { id });
export const createServer = (input: ServerInput) => invoke<number>('create_server', { input });
export const updateServer = (id: number, input: ServerInput) =>
  invoke<void>('update_server', { id, input });
export const deleteServer = (id: number) => invoke<void>('delete_server', { id });
export const connectServer = (id: number) => invoke<string>('connect_server', { id });
export const confirmHostKey = (id: number, fingerprint: string) =>
  invoke<void>('confirm_host_key', { id, fingerprint });
export const disconnectServer = (id: number) => invoke<void>('disconnect_server', { id });
export const serverConnectionStatus = (id: number) =>
  invoke<boolean>('server_connection_status', { id });
export const executeCommand = (serverId: number, command: string, ctx: AuditContext) =>
  invoke<ExecuteResult>('execute_command', { serverId, command, ctx });

// ============ 审计日志 ============
export const queryAuditLogs = (filter: AuditFilter) =>
  invoke<AuditLog[]>('query_audit_logs', { filter });
export const getSessionAuditLogs = (sessionId: string) =>
  invoke<AuditLog[]>('get_session_audit_logs', { sessionId });
export const auditStats = () =>
  invoke<{ total: number; success: number; failed: number }>('audit_stats');

// ============ Skills ============
export const listSkills = () => invoke<Skill[]>('list_skills');
export const listEnabledSkills = () => invoke<Skill[]>('list_enabled_skills');
export const getSkill = (id: string) => invoke<Skill>('get_skill', { id });
export const upsertSkill = (skill: Skill) => invoke<void>('upsert_skill', { skill });
export const deleteSkill = (id: string) => invoke<void>('delete_skill', { id });
export const toggleSkill = (id: string, enabled: boolean) =>
  invoke<void>('toggle_skill', { id, enabled });

// ============ 快捷指令 ============
export const listQuickActions = () => invoke<QuickAction[]>('list_quick_actions');
export const upsertQuickAction = (action: QuickAction) =>
  invoke<void>('upsert_quick_action', { action });
export const deleteQuickAction = (id: string) => invoke<void>('delete_quick_action', { id });

// ============ 文档 ============
export const listDocs = () => invoke<Doc[]>('list_docs');
export const getDoc = (id: string) => invoke<Doc>('get_doc', { id });
export const upsertDoc = (doc: Doc) => invoke<void>('upsert_doc', { doc });
export const updateDocStatus = (id: string, status: Doc['status']) =>
  invoke<void>('update_doc_status', { id, status });
export const deleteDoc = (id: string) => invoke<void>('delete_doc', { id });
export const docToSkill = (docId: string, skillId: string, title: string) =>
  invoke<void>('doc_to_skill', { docId, skillId, title });

// ============ Providers ============
export const listProviders = () => invoke<Provider[]>('list_providers');
export const getProvider = (id: string) => invoke<Provider>('get_provider', { id });
export const createProvider = (input: ProviderInput) =>
  invoke<string>('create_provider', { input });
export const updateProvider = (id: string, input: ProviderInput) =>
  invoke<void>('update_provider', { id, input });
export const deleteProvider = (id: string) => invoke<void>('delete_provider', { id });

// ============ SFTP ============
export const sftpListDir = (serverId: number, path: string) =>
  invoke<DirEntry[]>('sftp_list_dir', { serverId, path });
export const sftpReadFile = (serverId: number, path: string) =>
  invoke<string>('sftp_read_file', { serverId, path });
export const sftpWriteFile = (serverId: number, path: string, content: string) =>
  invoke<void>('sftp_write_file', { serverId, path, content });
export const sftpDeleteFile = (serverId: number, path: string) =>
  invoke<void>('sftp_delete_file', { serverId, path });
export const sftpMkdir = (serverId: number, path: string) =>
  invoke<void>('sftp_mkdir', { serverId, path });
export const sftpRmdir = (serverId: number, path: string) =>
  invoke<void>('sftp_rmdir', { serverId, path });
export const sftpRename = (serverId: number, from: string, to: string) =>
  invoke<void>('sftp_rename', { serverId, from, to });
export const sftpStat = (serverId: number, path: string) =>
  invoke<{ canonical: string; exists: boolean; is_dir: boolean; size: number }>(
    'sftp_stat', { serverId, path }
  );

// ============ 监控 ============
export const getMetrics = (serverId: number) =>
  invoke<ServerMetrics>('get_metrics', { serverId });

// ============ 容器 ============
export const listContainers = (serverId: number, runtime?: string) =>
  invoke<Container[]>('list_containers', { serverId, runtime });
export const controlContainer = (serverId: number, action: ContainerAction) =>
  invoke<ExecuteResult>('control_container', { serverId, action });

// ============ systemd ============
export const listServices = (serverId: number) =>
  invoke<Service[]>('list_services', { serverId });
export const controlService = (
  serverId: number, serviceName: string, action: string, sessionId?: string
) => invoke<ExecuteResult>('control_service', { serverId, serviceName, action, sessionId });

// ============ 交互式终端流 ============
export const terminalOpen = (serverId: number, cols?: number, rows?: number, terminalId?: string) =>
  invoke<string>('terminal_open', { serverId, cols, rows, terminalId });
export const terminalInput = (terminalId: string, data: string) =>
  invoke<void>('terminal_input', { terminalId, data });
export const terminalResize = (terminalId: string, cols: number, rows: number) =>
  invoke<void>('terminal_resize', { terminalId, cols, rows });
export const terminalClose = (terminalId: string) =>
  invoke<void>('terminal_close', { terminalId });

/** 监听终端输出(base64 编码的服务器输出) */
export const onTerminalOutput = (
  terminalId: string,
  handler: (bytes: Uint8Array) => void
): Promise<UnlistenFn> =>
  listen<{ data: string }>(`terminal_output_${terminalId}`, (e) => {
    const bytes = Uint8Array.from(atob(e.payload.data), c => c.charCodeAt(0));
    handler(bytes);
  });

/** 监听终端退出 */
export const onTerminalExit = (
  terminalId: string,
  handler: (code: number) => void
): Promise<UnlistenFn> =>
  listen<{ code: number }>(`terminal_exit_${terminalId}`, (e) => {
    handler(e.payload.code);
  });

// ============ 诊断 ============
/** 前端日志桥:关键节点打到后端日志(排查用) */
export const frontendLog = (msg: string) =>
  invoke<void>('frontend_log', { msg }).catch(() => {});

// ============ 终端输出缓冲(解决"打开时序"问题)============
//
// 问题:后端 PTY 一开就推数据,但前端 xterm 可能还没挂载好,
// 导致初始输出(shell 欢迎信息、提示符)丢失 → 终端全黑。
//
// 方案:terminal_open 前先调用 beginTerminalBuffer(id) 注册监听并缓冲输出,
// xterm 挂载后调用 attachTerminalBuffer(id, write) 回放缓冲 + 接管后续输出。

interface TermBuffer {
  chunks: Uint8Array[];       // 缓冲的输出
  writer: ((bytes: Uint8Array) => void) | null; // xterm 写入函数
  unlisten: UnlistenFn | null;
  exited: number | null;      // 退出码(-1=断开)
}

const termBuffers = new Map<string, TermBuffer>();

/** 在开 PTY 前调用:注册监听,开始缓冲输出 */
export async function beginTerminalBuffer(terminalId: string): Promise<void> {
  if (termBuffers.has(terminalId)) return;
  const buf: TermBuffer = { chunks: [], writer: null, unlisten: null, exited: null };
  let received = 0;

  // 输出事件:有 writer 就直接写,否则进缓冲
  buf.unlisten = await listen<{ data: string }>(`terminal_output_${terminalId}`, (e) => {
    received++;
    const bytes = Uint8Array.from(atob(e.payload.data), c => c.charCodeAt(0));
    if (received <= 3) {
      frontendLog(`监听器收到 chunk #${received} (${bytes.length}B) writer=${buf.writer ? '有' : '无(进缓冲)'} id=${terminalId.slice(0, 16)}`);
    }
    if (buf.writer) {
      buf.writer(bytes);
    } else {
      buf.chunks.push(bytes);
    }
  });
  frontendLog(`beginTerminalBuffer 监听已注册 id=${terminalId.slice(0, 16)}`);

  // 退出事件:记录退出码
  await listen<{ code: number }>(`terminal_exit_${terminalId}`, (e) => {
    buf.exited = e.payload.code;
    frontendLog(`收到退出事件 code=${e.payload.code} id=${terminalId.slice(0, 16)}`);
  });

  termBuffers.set(terminalId, buf);
}

/** xterm 挂载后调用:回放缓冲 + 接管后续输出 */
export function attachTerminalBuffer(
  terminalId: string,
  write: (bytes: Uint8Array) => void
): void {
  const buf = termBuffers.get(terminalId);
  if (!buf) {
    frontendLog(`attachTerminalBuffer 失败:缓冲不存在! id=${terminalId.slice(0, 16)}`);
    return;
  }
  buf.writer = write;
  const n = buf.chunks.length;
  // 回放所有缓冲的输出
  for (const chunk of buf.chunks) {
    write(chunk);
  }
  buf.chunks = [];
  frontendLog(`attachTerminalBuffer 成功,回放 ${n} 个缓冲 chunk id=${terminalId.slice(0, 16)}`);
}

/** 查询终端是否已退出(供 UI 显示断开状态) */
export function getTerminalExitCode(terminalId: string): number | null {
  return termBuffers.get(terminalId)?.exited ?? null;
}

/** 清理缓冲(关闭终端时调用) */
export function disposeTerminalBuffer(terminalId: string): void {
  const buf = termBuffers.get(terminalId);
  buf?.unlisten?.();
  termBuffers.delete(terminalId);
}
