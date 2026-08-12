import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { Bot, Send, Check, X, Sparkles, Terminal, Loader2, AlertCircle, FileText } from 'lucide-react';
import { AgentSession, loadAgentConfig, loadEnabledSkills, loadAgentServers, AgentToolCall, AgentTurn } from '../lib/agent';
import type { AgentConfig } from '../lib/agent';
import * as ipc from '../lib/ipc';
import type { AgentMessage, AgentProposal } from '../context/AppContext';
import type { ExecuteResult } from '../types/backend';

/** 只读工具:自动执行,不走人工审批(结果回传 Agent 续轮) */
const READ_ONLY_TOOLS = new Set(['get_metrics', 'read_file', 'get_skill']);

/**
 * Agent 对话面板(可复用)
 *
 * 工具分发策略:
 * - 只读工具(get_metrics / read_file / get_skill):自动执行 → 结果回传 Agent 续轮
 * - 写工具(run_command / write_file):生成提案卡片,人工审批后才执行
 */
export const AgentChatPanel: React.FC<{ compact?: boolean; sessionId?: string | null }> = ({ compact = false, sessionId = null }) => {
  const {
    skills, servers, activeServerId, executeCommand, providers,
    upsertDoc,
  } = useApp();

  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [inputMsg, setInputMsg] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [session, setSession] = useState<AgentSession | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<AgentSession | null>(null);
  const prevConfigRef = useRef<AgentConfig | null>(null);
  const turnRef = useRef<Map<string, AgentTurn>>(new Map());
  const msgIdCounter = useRef(0);
  const [showSaveDoc, setShowSaveDoc] = useState(false);
  const sessionIdRef = useRef<string | null>(null);

  /** 持久化一条消息到后端 JSONL */
  const persistMessage = useCallback((msg: AgentMessage) => {
    if (!sessionIdRef.current) return;
    const stored = {
      id: msg.id,
      sender: msg.sender,
      content: msg.content,
      timestamp: msg.timestamp,
      proposal: msg.proposal,
    };
    ipc.appendAgentMessage(sessionIdRef.current, stored).catch(e =>
      console.error('[Agent] 消息持久化失败', e)
    );
  }, []);

  /** 更新消息列表,并持久化新增的消息 */
  const appendMessage = useCallback((msg: AgentMessage) => {
    setMessages(prev => [...prev, msg]);
    persistMessage(msg);
  }, [persistMessage]);

  // 唯一消息 ID(避免同毫秒冲突)
  const nextId = (prefix: string) => `${prefix}_${Date.now()}_${msgIdCounter.current++}`;

  /** 将消息最终状态持久化(用 setMessages updater 读最终值,JSONL append;加载时后端按 id 去重) */
  const finalizeMessage = useCallback((id: string) => {
    setMessages(prev => {
      const msg = prev.find(m => m.id === id);
      if (msg && sessionIdRef.current) {
        ipc.appendAgentMessage(sessionIdRef.current, {
          id: msg.id, sender: msg.sender, content: msg.content,
          timestamp: msg.timestamp, proposal: msg.proposal,
        }).catch(e => console.error('[Agent] 消息持久化失败', e));
      }
      return prev;
    });
  }, []);

  // 初始化 Agent 会话
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      const config = await loadAgentConfig();
      const enabledSkills = await loadEnabledSkills();
      const agentServers = await loadAgentServers();
      if (cancelled) return;
      if (!config) {
        prevConfigRef.current = null;
        sessionRef.current = null;
        setSession(null);
        return;
      }
      const prev = prevConfigRef.current;
      if (prev && prev.baseUrl === config.baseUrl && prev.model === config.model && prev.apiKey === config.apiKey) {
        prevConfigRef.current = config;
        return;
      }
      prevConfigRef.current = config;
      const s = new AgentSession(config, agentServers, enabledSkills);
      sessionRef.current = s;
      setSession(s);
    };
    init();
    return () => { cancelled = true; };
  }, [providers]);

  // 服务器/技能列表变化时刷新会话注入的上下文
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [agentServers, enabledSkills] = await Promise.all([loadAgentServers(), loadEnabledSkills()]);
        if (cancelled) return;
        sessionRef.current?.updateContext(agentServers, enabledSkills);
      } catch { /* 不打断对话 */ }
    })();
    return () => { cancelled = true; };
  }, [skills, servers]);

  // 会话切换时:加载历史消息
  useEffect(() => {
    sessionIdRef.current = sessionId;
    if (!sessionId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const stored = await ipc.loadAgentMessages(sessionId);
        if (cancelled) return;
        const restored: AgentMessage[] = stored.map(s => ({
          id: s.id,
          sender: s.sender as 'user' | 'agent' | 'system',
          content: s.content,
          timestamp: s.timestamp,
          proposal: s.proposal as AgentProposal | undefined,
        }));
        setMessages(restored);
      } catch (e) { console.error('[Agent] 加载历史消息失败', e); }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const h = (e: Event) => setInputMsg((e as CustomEvent<string>).detail);
    window.addEventListener('agent:set-input', h);
    return () => window.removeEventListener('agent:set-input', h);
  }, []);

  /** 校验 server_id 是否有效 */
  const validateServerId = (sid: unknown): number | null => {
    if (typeof sid !== 'number') return null;
    return servers.some(s => s.id === sid) ? sid : null;
  };

  /** 执行只读工具,返回结果文本(供 Agent 续轮) */
  const executeReadOnlyTool = async (call: AgentToolCall): Promise<string> => {
    switch (call.name) {
      case 'get_metrics': {
        const sid = validateServerId(call.arguments.server_id);
        if (!sid) throw new Error('get_metrics 缺少有效的 server_id');
        const m = await ipc.getMetrics(sid);
        return JSON.stringify(m);
      }
      case 'read_file': {
        const sid = validateServerId(call.arguments.server_id);
        const path = call.arguments.path;
        if (!sid) throw new Error('read_file 缺少有效的 server_id');
        if (typeof path !== 'string') throw new Error('read_file 缺少 path 参数');
        return await ipc.sftpReadFile(sid, path);
      }
      case 'get_skill': {
        const id = call.arguments.id;
        if (typeof id !== 'string') throw new Error('get_skill 缺少 id 参数');
        const skill = await ipc.getSkill(id);
        return skill.content;
      }
      default:
        throw new Error(`未知只读工具: ${call.name}`);
    }
  };

  /** 将工具执行结果回传 Agent,自动续轮 */
  const continueWithResult = async (
    call: AgentToolCall,
    resultText: string,
  ) => {
    if (!sessionRef.current) return;
    const resultMsgId = nextId('msg_agent');
    setMessages(prev => [...prev, {
      id: resultMsgId, sender: 'agent', content: '', streaming: true,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    }]);

    const callbacks = {
      onText: (text: string) => setMessages(prev => prev.map(m => m.id === resultMsgId ? { ...m, content: text } : m)),
      onProposal: () => {},
      onDone: (turn: AgentTurn) => {
        setMessages(prev => prev.map(m => m.id === resultMsgId ? {
          ...m, content: turn.text || '(分析完成)', streaming: false,
        } : m));
        finalizeMessage(resultMsgId);
        dispatchToolCalls(turn, resultMsgId);
      },
      onError: (err: Error) => {
        setMessages(prev => prev.map(m => m.id === resultMsgId ? {
          ...m, content: `错误: ${err.message}`, streaming: false,
        } : m));
        finalizeMessage(resultMsgId);
        setIsRunning(false);
      },
    };

    try {
      await sessionRef.current.continueAfterExecution(call, resultText, callbacks);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages(prev => prev.map(m => m.id === resultMsgId ? {
        ...m, content: `错误: ${msg}`, streaming: false,
      } : m));
      finalizeMessage(resultMsgId);
      setIsRunning(false);
    }
  };

  /** 工具分发:只读工具自动执行,写工具生成 proposal */
  const dispatchToolCalls = async (turn: AgentTurn, agentMsgId: string) => {
    if (turn.toolCalls.length === 0) {
      setIsRunning(false);
      return;
    }

    const call = turn.toolCalls[0];
    const isReadOnly = READ_ONLY_TOOLS.has(call.name);
    const forceApproval = call.arguments.safe_to_run === false;

    if (isReadOnly && !forceApproval) {
      // 只读工具:自动执行 → 结果回传 Agent 续轮(用户看到"正在执行只读查询"的提示)
      setMessages(prev => prev.map(m => m.id === agentMsgId ? {
        ...m,
        content: (turn.text || '') + `\n\n⏳ 自动执行只读工具 \`${call.name}\`…`,
      } : m));

      try {
        const resultText = await executeReadOnlyTool(call);
        // 先把工具结果展示给用户(附在当前消息后)
        const preview = resultText.length > 500 ? resultText.slice(0, 500) + '\n…(截断)' : resultText;
        setMessages(prev => prev.map(m => m.id === agentMsgId ? {
          ...m,
          content: (turn.text || '') + `\n\n✅ \`${call.name}\` 结果:\n\`\`\`\n${preview}\n\`\`\``,
        } : m));
        // 续轮:让 Agent 分析结果
        await continueWithResult(call, resultText);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setMessages(prev => prev.map(m => m.id === agentMsgId ? {
          ...m,
          content: (turn.text || '') + `\n\n⚠ 只读工具 \`${call.name}\` 执行失败: ${msg}`,
          streaming: false,
        } : m));
        finalizeMessage(agentMsgId);
        setIsRunning(false);
      }
      return;
    }

    // 写工具:生成 proposal 卡片
    let proposal: AgentProposal | null = null;

    if (call.name === 'run_command') {
      const sid = validateServerId(call.arguments.server_id);
      const cmd = call.arguments.command;
      if (!sid) {
        setMessages(prev => prev.map(m => m.id === agentMsgId ? {
          ...m, content: `⚠ Agent 提议缺少有效的目标服务器,已跳过。`, streaming: false,
        } : m));
        finalizeMessage(agentMsgId); setIsRunning(false); return;
      }
      if (typeof cmd !== 'string' || !cmd.trim()) {
        setMessages(prev => prev.map(m => m.id === agentMsgId ? {
          ...m, content: `⚠ Agent 提议缺少命令内容,已跳过。`, streaming: false,
        } : m));
        finalizeMessage(agentMsgId); setIsRunning(false); return;
      }
      const proposalId = `prop_${agentMsgId}`;
      turnRef.current.set(proposalId, turn);
      proposal = {
        id: proposalId,
        command: cmd,
        tool_name: 'run_command',
        server_id: sid,
        safe_to_run: call.arguments.safe_to_run as boolean | undefined,
        toolCall: { id: call.id, name: call.name, arguments: call.arguments },
        droppedToolCalls: turn.toolCalls.length - 1,
      };
    } else if (call.name === 'write_file') {
      const sid = validateServerId(call.arguments.server_id);
      const path = call.arguments.path;
      const content = call.arguments.content;
      if (!sid || typeof path !== 'string' || typeof content !== 'string') {
        setMessages(prev => prev.map(m => m.id === agentMsgId ? {
          ...m, content: `⚠ Agent 的 write_file 提议参数不完整,已跳过。`, streaming: false,
        } : m));
        finalizeMessage(agentMsgId); setIsRunning(false); return;
      }
      const proposalId = `prop_${agentMsgId}`;
      turnRef.current.set(proposalId, turn);
      proposal = {
        id: proposalId,
        command: `写入文件 ${path}`,
        tool_name: 'write_file',
        server_id: sid,
        toolCall: { id: call.id, name: call.name, arguments: call.arguments },
        droppedToolCalls: turn.toolCalls.length - 1,
      };
    } else {
      // 未知写工具
      setMessages(prev => prev.map(m => m.id === agentMsgId ? {
        ...m, content: `⚠ 不支持的工具: ${call.name},已跳过。`, streaming: false,
      } : m));
      finalizeMessage(agentMsgId); setIsRunning(false); return;
    }

    setMessages(prev => prev.map(m => m.id === agentMsgId ? {
      ...m,
      content: turn.text || '(Agent 提议执行以下操作,请审批)',
      streaming: false,
      proposal,
    } : m));
    finalizeMessage(agentMsgId);
    setIsRunning(false);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMsg.trim() || isRunning || !session) return;

    const userMsg: AgentMessage = {
      id: nextId('msg'), sender: 'user', content: inputMsg.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
    appendMessage(userMsg);  // 用户消息立即持久化
    setInputMsg('');
    setIsRunning(true);

    const agentMsgId = nextId('msg_agent');
    setMessages(prev => [...prev, {
      id: agentMsgId, sender: 'agent', content: '', streaming: true,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    }]);

    try {
      const turn = await session.sendMessage(userMsg.content, {
        onText: (text) => setMessages(prev => prev.map(m => m.id === agentMsgId ? { ...m, content: text } : m)),
        onProposal: () => {},
        onDone: (t) => {
          setMessages(prev => prev.map(m => m.id === agentMsgId ? {
            ...m, content: t.text || '', streaming: false,
          } : m));
        },
        onError: (err) => {
          setMessages(prev => prev.map(m => m.id === agentMsgId ? {
            ...m, content: `错误: ${err.message}`, streaming: false,
          } : m));
          finalizeMessage(agentMsgId);
          setIsRunning(false);
        },
      });
      await dispatchToolCalls(turn, agentMsgId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages(prev => prev.map(m => m.id === agentMsgId ? {
        ...m, content: `错误: ${msg}`, streaming: false,
      } : m));
      finalizeMessage(agentMsgId);
      setIsRunning(false);
    }
  };

  // 批准执行 Proposal(按工具类型分发)
  const handleApprove = async (proposalId: string) => {
    if (!session) return;
    const msg = messages.find(m => m.proposal?.id === proposalId);
    if (!msg?.proposal) return;
    const proposal = msg.proposal;
    const toolCall = proposal.toolCall;
    if (!toolCall) return;

    setMessages(prev => prev.map(m => m.proposal?.id === proposalId ? {
      ...m, proposal: { ...m.proposal!, approved: true }
    } : m));

    setIsRunning(true);
    const resultMsgId = nextId('msg_agent');
    setMessages(prev => [...prev, {
      id: resultMsgId, sender: 'agent', content: '', streaming: true,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    }]);

    try {
      let resultText: string;
      let execResult: ExecuteResult | undefined;

      if (proposal.tool_name === 'run_command') {
        execResult = await executeCommand(proposal.server_id, proposal.command, {
          source: 'agent',
          tool_name: 'run_command',
          approved_by: 'user',
          proposal_id: proposalId,
        });
        setMessages(prev => prev.map(m => m.proposal?.id === proposalId ? {
          ...m, proposal: { ...m.proposal!, result: execResult }
        } : m));
        resultText = `命令执行完成。\nstdout:\n${execResult.stdout}\n${execResult.stderr ? 'stderr:\n' + execResult.stderr + '\n' : ''}退出码:${execResult.exit_code}`;
      } else if (proposal.tool_name === 'write_file') {
        const path = toolCall.arguments.path as string;
        const content = toolCall.arguments.content as string;
        await ipc.sftpWriteFile(proposal.server_id, path, content);
        execResult = { audit_id: 0, stdout: `文件 ${path} 已写入(${content.length} 字符)`, stderr: '', exit_code: 0, success: true };
        setMessages(prev => prev.map(m => m.proposal?.id === proposalId ? {
          ...m, proposal: { ...m.proposal!, result: execResult }
        } : m));
        resultText = `文件写入完成: ${path}(${content.length} 字符)`;
      } else {
        throw new Error(`不支持的审批工具: ${proposal.tool_name}`);
      }

      // 续轮:让 Agent 分析执行结果
      const callbacks = {
        onText: (text: string) => setMessages(prev => prev.map(m => m.id === resultMsgId ? { ...m, content: text } : m)),
        onProposal: () => {},
        onDone: (t: AgentTurn) => {
          setMessages(prev => prev.map(m => m.id === resultMsgId ? { ...m, content: t.text || '(完成)', streaming: false } : m));
          finalizeMessage(resultMsgId);
          dispatchToolCalls(t, resultMsgId);
        },
        onError: (err: Error) => {
          setMessages(prev => prev.map(m => m.id === resultMsgId ? { ...m, content: `错误: ${err.message}`, streaming: false } : m));
          finalizeMessage(resultMsgId);
          setIsRunning(false);
        },
      };

      const turn = turnRef.current.get(proposalId);
      if (turn) {
        await session.continueAfterExecution(toolCall, resultText, callbacks);
      } else {
        await session.sendMessage(resultText, callbacks);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages(prev => prev.map(m => m.id === resultMsgId ? { ...m, content: `错误: ${msg}`, streaming: false } : m));
      finalizeMessage(resultMsgId);
      setIsRunning(false);
    }
  };

  const handleReject = (proposalId: string) => {
    let msgId = '';
    setMessages(prev => prev.map(m => {
      if (m.proposal?.id === proposalId) { msgId = m.id; return { ...m, proposal: { ...m.proposal!, approved: false } }; }
      return m;
    }));
    if (msgId) setTimeout(() => finalizeMessage(msgId), 0);
  };

  /** 将当前对话存为复盘文档 */
  const handleSaveAsDoc = async (title: string) => {
    const transcript = messages
      .filter(m => m.sender !== 'system')
      .map(m => {
        const time = m.timestamp;
        if (m.sender === 'user') return `## [${time}] 用户\n${m.content}`;
        const prop = m.proposal ? `\n\n> 提议: ${m.proposal.command}${m.proposal.result ? `(退出码:${m.proposal.result.exit_code})` : ''}` : '';
        return `## [${time}] Agent\n${m.content}${prop}`;
      })
      .join('\n\n---\n\n');

    const content = `# 运维复盘: ${title}\n\n> 由 Witchcat Agent 对话沉淀生成\n\n${transcript}`;
    await upsertDoc({
      id: `doc_${Date.now()}`,
      type: 'postmortem',
      title,
      content,
      session_id: null,
      server_id: activeServerId,
      generated_by: 'agent',
      tags: JSON.stringify(['agent-session']),
      status: 'draft',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    setShowSaveDoc(false);
  };

  const currentServer = servers.find(s => s.id === activeServerId);
  const enabledSkills = skills.filter(s => s.enabled);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 节点信息条 */}
      <div style={{
        background: 'rgba(139, 92, 246, 0.1)', border: '1px solid rgba(139, 92, 246, 0.2)',
        padding: compact ? '6px 10px' : '8px 12px', borderRadius: 6, fontSize: compact ? 11 : 12,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: compact ? 8 : 12, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <Sparkles size={compact ? 12 : 14} style={{ color: 'var(--accent-purple)', flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            节点: <strong>{currentServer?.name || '未选择'}</strong>
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {messages.length > 0 && (
            <button
              className="btn btn-secondary"
              style={{ fontSize: compact ? 10 : 11, padding: '2px 8px' }}
              onClick={() => setShowSaveDoc(true)}
              title="将当前对话存为复盘文档"
            >
              <FileText size={12} /> {!compact && '存为文档'}
            </button>
          )}
          <span style={{ color: 'var(--accent-emerald)', fontSize: compact ? 10 : 11 }}>
            {enabledSkills.length} 项技能
          </span>
        </div>
      </div>

      {/* 消息列表 */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: compact ? 10 : 14, paddingRight: 4, minHeight: 0 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: compact ? '24px 8px' : 40 }}>
            <Bot size={compact ? 30 : 40} style={{ marginBottom: 8, opacity: 0.3 }} />
            <div style={{ fontSize: compact ? 12 : 13 }}>向 Agent 描述你的运维需求</div>
            {!session && <div style={{ fontSize: 11, marginTop: 8, color: 'var(--accent-rose)' }}>请先在设置中配置 LLM Provider</div>}
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} style={{ alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start', maxWidth: compact ? '96%' : '85%', display: 'flex', gap: compact ? 6 : 10 }}>
            {msg.sender === 'agent' && !compact && (
              <div style={{ background: 'var(--accent-purple)', color: '#fff', width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Bot size={16} />
              </div>
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{
                background: msg.sender === 'user' ? 'rgba(6, 182, 212, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                border: '1px solid',
                borderColor: msg.sender === 'user' ? 'rgba(6, 182, 212, 0.3)' : 'var(--border-color)',
                padding: compact ? '8px 10px' : '10px 14px', borderRadius: 10,
                fontSize: compact ? 12 : 13, lineHeight: 1.6, wordBreak: 'break-word',
              }}>
                {msg.streaming && !msg.content ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-dim)' }}>
                    <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> 思考中...
                  </span>
                ) : msg.content.startsWith('错误:') ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--accent-rose)' }}>
                    <AlertCircle size={14} /> {msg.content}
                  </span>
                ) : (
                  <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                )}

                {/* Proposal 卡片 */}
                {msg.proposal && (
                  <ProposalCard
                    proposal={msg.proposal}
                    compact={compact}
                    onApprove={handleApprove}
                    onReject={handleReject}
                  />
                )}
              </div>
              {!compact && (
                <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4, textAlign: msg.sender === 'user' ? 'right' : 'left' }}>
                  {msg.timestamp}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入框 */}
      <form onSubmit={handleSend} style={{ display: 'flex', gap: 8, marginTop: compact ? 8 : 12, flexShrink: 0 }}>
        <input
          className="input-field"
          placeholder={compact ? '问 Agent…' : '输入运维需求,例如:检查 Nginx 连接数,排查磁盘占满问题...'}
          style={compact ? { fontSize: 12, height: 32 } : undefined}
          value={inputMsg}
          onChange={e => setInputMsg(e.target.value)}
          disabled={isRunning}
        />
        <button type="submit" className="btn btn-primary" style={compact ? { height: 32, padding: '0 12px' } : undefined} disabled={isRunning || !session}>
          <Send size={14} /> {!compact && '发送'}
        </button>
      </form>

      {/* 存为文档弹窗 */}
      {showSaveDoc && (
        <SaveDocDialog
          defaultTitle={`运维对话 ${new Date().toLocaleDateString()}`}
          onSave={handleSaveAsDoc}
          onCancel={() => setShowSaveDoc(false)}
        />
      )}
    </div>
  );
};

// ==================== Proposal 卡片(按工具类型渲染) ====================

const ProposalCard: React.FC<{
  proposal: AgentProposal;
  compact?: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}> = ({ proposal, compact, onApprove, onReject }) => {
  const isWriteFile = proposal.tool_name === 'write_file';
  const fileContent = isWriteFile ? String(proposal.toolCall?.arguments.content ?? '') : '';
  const filePath = isWriteFile ? String(proposal.toolCall?.arguments.path ?? '') : '';

  return (
    <div style={{ marginTop: 10, background: '#070a10', border: '1px solid var(--accent-purple)', borderRadius: 8, padding: compact ? 8 : 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-purple)', display: 'flex', alignItems: 'center', gap: 4 }}>
          {isWriteFile ? <FileText size={12} /> : <Terminal size={12} />}
          {isWriteFile ? '提议写入文件' : '提议执行命令'}
        </span>
        <span style={{ fontSize: 10, background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: 4 }}>
          {proposal.tool_name}
          {proposal.safe_to_run && ' · 安全'}
        </span>
      </div>

      {isWriteFile ? (
        <>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: compact ? 11 : 12, color: 'var(--accent-cyan)', marginBottom: 6 }}>
            📄 {filePath}
          </div>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: compact ? 11 : 12,
            background: 'rgba(0,0,0,0.5)', padding: 8, borderRadius: 4,
            color: 'var(--text-main)', marginBottom: 10,
            maxHeight: 120, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>
            {fileContent.slice(0, 500)}{fileContent.length > 500 && '\n…(仅预览前500字符)'}
          </div>
        </>
      ) : (
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: compact ? 11 : 12,
          background: 'rgba(0,0,0,0.5)', padding: 8, borderRadius: 4,
          color: 'var(--accent-cyan)', marginBottom: 10,
          overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>
          {proposal.command}
        </div>
      )}

      {!!proposal.droppedToolCalls && (
        <div style={{ fontSize: 11, color: 'var(--accent-amber)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
          <AlertCircle size={12} />
          本轮还有 {proposal.droppedToolCalls} 个工具调用未列出
        </div>
      )}

      {proposal.approved === undefined && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-danger" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => onReject(proposal.id)}>
            <X size={12} /> 拒绝
          </button>
          <button className="btn btn-primary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => onApprove(proposal.id)}>
            <Check size={12} /> 批准执行
          </button>
        </div>
      )}
      {proposal.approved === true && (
        <div style={{ color: 'var(--accent-emerald)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
          <Check size={14} /> 已批准并执行
        </div>
      )}
      {proposal.approved === false && (
        <div style={{ color: 'var(--accent-rose)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
          <X size={14} /> 已拒绝执行
        </div>
      )}
      {proposal.result && (
        <div style={{ marginTop: 8, fontSize: 11, background: '#020305', padding: 8, borderRadius: 4, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', maxHeight: 100, overflowY: 'auto' }}>
          {proposal.result.stdout}
        </div>
      )}
    </div>
  );
};

// ==================== 存为文档弹窗 ====================

const SaveDocDialog: React.FC<{
  defaultTitle: string;
  onSave: (title: string) => void;
  onCancel: () => void;
}> = ({ defaultTitle, onSave, onCancel }) => {
  const [title, setTitle] = useState(defaultTitle);
  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 420 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>将对话存为复盘文档</h3>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>文档标题</label>
          <input
            className="input-field"
            value={title}
            onChange={e => setTitle(e.target.value)}
            autoFocus
          />
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 16 }}>
          对话内容将保存为复盘文档(草稿状态),可在文档中心查看并转为 SOP 技能。
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button className="btn btn-secondary" onClick={onCancel}><X size={14} /> 取消</button>
          <button className="btn btn-primary" onClick={() => onSave(title)} disabled={!title.trim()}>
            <Check size={14} /> 保存
          </button>
        </div>
      </div>
    </div>
  );
};
