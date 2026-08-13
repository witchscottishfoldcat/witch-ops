// Witchcat Ops IPC 契约类型定义 (匹配 docs/BACKEND_API.md)

export type ErrorCode = 
  | 'database' 
  | 'ssh' 
  | 'not_connected' 
  | 'not_found' 
  | 'vault' 
  | 'crypto' 
  | 'keychain' 
  | 'invalid_input' 
  | 'cancelled' 
  | 'internal';

export interface Server {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_method: 'password' | 'private_key';
  credential_enc: string | null;
  proxy: string | null;
  host_key_fingerprint: string | null;
  tags: string | null; // JSON Array string e.g. '["web","prod"]'
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServerInput {
  name: string;
  host: string;
  port?: number;
  username: string;
  auth_method?: 'password' | 'private_key';
  credential?: string;
  tags?: string[];
  note?: string;
}

export interface AuditContext {
  source: 'agent' | 'manual_terminal' | 'quick_action' | 'mcp_external';
  session_id?: string;
  tool_name: string;
  command?: string;
  args?: string;
  approved_by?: string;
  proposal_id?: string;
}

export interface ExecuteResult {
  audit_id: number;
  stdout: string;
  stderr: string;
  exit_code: number;
  success: boolean;
}

/** Agent 提案执行结果(execute_agent_proposal 返回,审批上下文由服务端构建) */
export interface AgentExecutionResult {
  proposal_id: string;
  result: {
    stdout: string;
    stderr: string;
    exit_code: number;
  };
  audit_id: number;
}

export interface AuditFilter {
  server_id?: number;
  session_id?: string;
  source?: string;
  success?: boolean;
  search?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface AuditLog {
  id: number;
  timestamp: string;
  session_id: string | null;
  server_id: number | null;
  server_host: string | null;
  source: string;
  tool_name: string;
  command: string | null;
  args: string | null;
  exit_code: number | null;
  output: string | null;
  success: boolean;
  approved_by: string | null;
  proposal_id: string | null;
  duration_ms: number | null;
}

export interface Skill {
  id: string;
  title: string;
  content: string;
  triggers: string | null; // JSON array
  tags: string | null;     // JSON array
  applies_to: string | null; // JSON array
  risk_level: 'low' | 'medium' | 'high';
  enabled: boolean;
  source: 'manual' | 'from_doc';
  source_doc_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface QuickActionStep {
  type: 'command';
  value: string;
  capture?: string;
  guard?: string;
  confirm?: boolean;
}

export interface QuickAction {
  id: string;
  name: string;
  icon: string | null;
  target: string | null; // JSON e.g. { type: 'server', id: 1 }
  steps: string; // JSON array of QuickActionStep
  approval: 'always_ask' | 'auto_review' | 'always_approve';
  audit: boolean;
  created_at: string;
  updated_at: string;
}

export interface Doc {
  id: string;
  type: 'change_record' | 'postmortem' | 'sop';
  title: string;
  content: string;
  session_id: string | null;
  server_id: number | null;
  generated_by: 'agent' | 'user' | null;
  tags: string | null;
  status: 'draft' | 'reviewed' | 'archived';
  created_at: string;
  updated_at: string;
}

export interface ProviderInput {
  name: string;
  base_url: string;
  api_key: string;
  default_model?: string;
  models?: string[];
}

export interface Provider {
  id: string;
  name: string;
  base_url: string;
  api_key_enc: string;
  default_model: string | null;
  models: string | null; // JSON array
  created_at: string;
  updated_at: string;
}

export interface DirEntry {
  name: string;
  is_dir: boolean;
  is_symlink: boolean;
  size: number;
  modified: string | null;
  permissions: number | null;
}

export interface DiskInfo {
  filesystem: string;
  mount: string;
  total: number; // KB
  used: number;  // KB
  avail: number; // KB
  usage_percent: number;
}

export interface ServerMetrics {
  cpu_usage: number;
  mem_total: number;
  mem_used: number;
  mem_available: number;
  swap_total: number;
  swap_used: number;
  load_1: number;
  load_5: number;
  load_15: number;
  uptime_seconds: number;
  disks: DiskInfo[];
}

export interface Container {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string; // running / exited
  runtime: string;
}

export interface ContainerAction {
  container_id: string;
  action: 'start' | 'stop' | 'restart' | 'remove';
  session_id?: string;
}

export interface Service {
  name: string;
  load_state: string;
  active_state: string; // active / inactive / failed
  sub_state: string;
  description: string;
}
