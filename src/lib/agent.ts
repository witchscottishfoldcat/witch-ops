// Witchcat Ops Agent 引擎(前端 LLM 调用)
//
// 设计(借鉴 MaidKit ssh_agent_service.dart):
// - 自己写 fetch 调 OpenAI 兼容 API,不走 SDK(保留 reasoning_content)
// - Proposal 与 Execution 解耦:LLM 只能提案,审批后才执行
// - 工具带 safe_to_run 标记
// - 输出截断防 token 爆炸
//
// 用法:
//   const session = new AgentSession(providers, skills, servers)
//   await session.sendMessage(userText, { onText, onProposal, onDone })

import * as ipc from './ipc';
import type { AuditContext, ExecuteResult } from '../types/backend';

// ============ 类型 ============

export interface AgentConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AgentServer {
  id: number;
  name: string;
  host: string;
}

export interface AgentSkillInfo {
  id: string;
  title: string;
  triggers: string[];
}

export interface AgentToolCall {
  id: string;
  name: string;           // run_command / read_file / ... / mcp_xxx__yyy
  arguments: Record<string, unknown>;
}

export interface AgentTurn {
  text: string | null;
  reasoning: string | null;
  toolCalls: AgentToolCall[];
}

export interface AgentCallbacks {
  onText: (text: string) => void;
  onProposal: (call: AgentToolCall) => void;
  onDone: (turn: AgentTurn) => void;
  onError: (err: Error) => void;
}

// ============ 工具定义 ============

const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'run_command',
      description: 'Run one shell command on the selected server',
      parameters: {
        type: 'object',
        properties: {
          server_id: { type: 'integer', description: 'Target server ID' },
          command: { type: 'string', description: 'Shell command to run' },
          safe_to_run: { type: 'boolean', description: 'True if read-only/safe' },
        },
        required: ['server_id', 'command'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: 'Read a UTF-8 text file from the selected server',
      parameters: {
        type: 'object',
        properties: {
          server_id: { type: 'integer' },
          path: { type: 'string' },
          safe_to_run: { type: 'boolean' },
        },
        required: ['server_id', 'path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'write_file',
      description: 'Create or replace a UTF-8 text file on the selected server',
      parameters: {
        type: 'object',
        properties: {
          server_id: { type: 'integer' },
          path: { type: 'string' },
          content: { type: 'string' },
          safe_to_run: { type: 'boolean' },
        },
        required: ['server_id', 'path', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_metrics',
      description: 'Get CPU/memory/disk/load metrics for the server',
      parameters: {
        type: 'object',
        properties: {
          server_id: { type: 'integer' },
          safe_to_run: { type: 'boolean' },
        },
        required: ['server_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_skill',
      description: 'Read a skill/SOP document by ID (call when you need specific operational guidance)',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Skill ID' },
          safe_to_run: { type: 'boolean' },
        },
        required: ['id'],
      },
    },
  },
];

// ============ Agent Session ============

export class AgentSession {
  private config: AgentConfig;
  private servers: AgentServer[];
  private skills: AgentSkillInfo[];
  private history: Array<Record<string, unknown>> = [];
  private cancelFlag = false;
  private abortController: AbortController | null = null;

  constructor(
    config: AgentConfig,
    servers: AgentServer[],
    skills: AgentSkillInfo[],
  ) {
    this.config = config;
    this.servers = servers;
    this.skills = skills;
  }

  /** 更新会话上下文(服务器/技能列表变化时调用,保留对话历史) */
  updateContext(servers: AgentServer[], skills: AgentSkillInfo[]) {
    this.servers = servers;
    this.skills = skills;
  }

  /** 构建系统提示 */
  private systemPrompt(): string {
    const serverList = this.servers.map(s => `- ${s.name} (id=${s.id}, host=${s.host})`).join('\n');
    const skillList = this.skills.length > 0
      ? this.skills.map(s => `- ${s.id}: ${s.title}`).join('\n')
      : '(无)';
    return `You are Witchcat Ops, an AI assistant for server operations.

Available servers:
${serverList}

Available SOP skills:
${skillList}

Rules:
- ALWAYS propose actions via tool calls. Never directly claim to have executed something.
- Set safe_to_run=true only for read-only operations (read_file, get_metrics, get_skill, ls/cat/status).
- For destructive or risky operations, set safe_to_run=false so the user reviews them.
- Be concise. When a command completes, summarize the result.
- If the user asks about a server not in the list, say so.`;
  }

  /** 取消当前请求(立即中止底层 fetch,不再等网络响应) */
  cancel() {
    this.cancelFlag = true;
    this.abortController?.abort();
  }

  /** 发送用户消息,返回 Agent 的第一轮输出(含可能的 Proposal) */
  async sendMessage(userText: string, callbacks: AgentCallbacks): Promise<AgentTurn> {
    this.cancelFlag = false;
    this.history.push({ role: 'user', content: userText });
    const turn = await this.streamChat(callbacks);
    return turn;
  }

  /** 批准执行某个 Proposal(由 UI 在用户批准后调用) */
  async executeProposal(call: AgentToolCall, ctx: AuditContext): Promise<ExecuteResult> {
    const result = await ipc.executeCommand(
      call.arguments.server_id as number,
      call.arguments.command as string,
      ctx,
    );
    return result;
  }

  /** 续轮:把执行结果塞回历史,继续对话 */
  async continueAfterExecution(
    call: AgentToolCall,
    result: string,
    callbacks: AgentCallbacks,
  ): Promise<AgentTurn> {
    // 塞 assistant 消息(含 tool_call)
    this.history.push({
      role: 'assistant',
      tool_calls: [{
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      }],
    });
    // 塞 tool 结果
    this.history.push({
      role: 'tool',
      tool_call_id: call.id,
      content: result,
    });
    return this.streamChat(callbacks);
  }

  // ============ 内部:流式调用 LLM ============

  private async streamChat(callbacks: AgentCallbacks): Promise<AgentTurn> {
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const messages = [
      { role: 'system', content: this.systemPrompt() },
      ...this.history,
    ];

    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // fetch 网络层错误(断网/DNS 失败/Provider 配置错误)必须走 onError,
    // 否则 UI 的占位消息会永远停在"思考中"
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          stream: true,
          temperature: 0.2,
          tools: TOOLS,
          messages,
        }),
        signal,
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      callbacks.onError(error);
      throw error;
    }

    if (!resp.ok) {
      const err = await resp.text();
      const error = new Error(`LLM API 错误 ${resp.status}: ${err}`);
      callbacks.onError(error);
      throw error;
    }

    if (!resp.body) {
      const error = new Error('LLM 响应没有数据流(可能是流式支持被关闭)');
      callbacks.onError(error);
      throw error;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let reasoning = '';
    const toolCallsMap = new Map<number, { name?: string; arguments?: string }>();

    try {
      while (true) {
        if (this.cancelFlag) break;
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // 按行解析 SSE
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;

          try {
            const json = JSON.parse(data);
            if (json.error) {
              throw new Error(json.error.message || 'LLM 错误');
            }
            const delta = json.choices?.[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
              text += delta.content;
              callbacks.onText(text);
            }
            if (delta.reasoning_content) {
              reasoning += delta.reasoning_content;
            }
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index;
                if (idx === undefined) continue;
                const acc = toolCallsMap.get(idx) || {};
                if (tc.function?.name) acc.name = tc.function.name;
                if (tc.function?.arguments) acc.arguments = (acc.arguments || '') + tc.function.arguments;
                toolCallsMap.set(idx, acc);
              }
            }
          } catch {
            // 忽略单条解析错误
          }
        }
      }
    } catch (err) {
      if (this.cancelFlag) {
        // 用户主动取消:把已积累的内容作为结果返回,不报错
      } else {
        const error = err instanceof Error ? err : new Error(String(err));
        callbacks.onError(error);
        throw error;
      }
    } finally {
      this.abortController = null;
      reader.releaseLock();
    }

    // 防御:LLM 返回的 tool_call arguments 可能不是合法 JSON,解析失败视为空参数
    const toolCalls: AgentToolCall[] = Array.from(toolCallsMap.values()).map((tc, i) => {
      let args: Record<string, unknown> = {};
      if (tc.arguments) {
        try { args = JSON.parse(tc.arguments); } catch { args = {}; }
      }
      return {
        id: `call_${Date.now()}_${i}`,
        name: tc.name || 'unknown',
        arguments: args,
      };
    });

    const turn: AgentTurn = {
      text: text || null,
      reasoning: reasoning || null,
      toolCalls,
    };

    // 保存到历史(assistant 消息)。
    // 注意:带 tool_calls 的轮次**不**入历史 —— 必须等工具执行结果,
    // 由 continueAfterExecution 以「assistant(tool_call) + tool(结果)」成对补入,
    // 否则模型上下文缺失自己提议的命令,且 API 会因 tool_call 未响应而报错。
    if (text) this.history.push({ role: 'assistant', content: text });

    callbacks.onDone(turn);
    return turn;
  }
}

// ============ 辅助:从后端加载配置 ============

/** 加载当前可用的 LLM 配置(从第一个已解锁的 provider) */
export async function loadAgentConfig(): Promise<AgentConfig | null> {
  const providers = await ipc.listProviders();
  const p = providers.find(pr => pr.api_key_enc && pr.api_key_enc !== '***');
  if (!p) return null;
  let models: string[] = [];
  if (p.models) {
    try { models = JSON.parse(p.models); } catch { models = []; }
  }
  const model = p.default_model || models[0] || 'gpt-4o';
  return { baseUrl: p.base_url, apiKey: p.api_key_enc, model };
}

/** 加载启用的技能(注入系统提示) */
export async function loadEnabledSkills(): Promise<AgentSkillInfo[]> {
  const skills = await ipc.listEnabledSkills();
  return skills.map(s => {
    let triggers: string[] = [];
    if (s.triggers) {
      try { triggers = JSON.parse(s.triggers); } catch { triggers = []; }
    }
    return { id: s.id, title: s.title, triggers };
  });
}

/** 加载服务器列表 */
export async function loadAgentServers(): Promise<AgentServer[]> {
  const servers = await ipc.listServers();
  return servers.map(s => ({ id: s.id, name: s.name, host: s.host }));
}

/** 执行 get_skill 工具(从后端加载技能内容) */
export async function executeGetSkill(id: string): Promise<string> {
  const skill = await ipc.getSkill(id);
  return skill.content;
}
