import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { Bot, Send, Check, X, Sparkles, Terminal, Loader2, AlertCircle } from 'lucide-react';
import { AgentSession, loadAgentConfig, loadEnabledSkills, loadAgentServers } from '../lib/agent';
import type { AgentMessage } from '../context/AppContext';

/**
 * Agent 对话面板(可复用)
 *
 * 从 AgentCopilot 抽取的对话核心:会话初始化、流式收发、
 * 提案卡片审批执行。两处使用:
 * - AgentCopilot 全页模式
 * - TerminalView 右侧栏(compact 紧凑模式)
 *
 * 注意:每个实例持有独立的 AgentSession 与消息列表(互不共享上下文)。
 */
export const AgentChatPanel: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { skills, servers, activeServerId, executeCommand, providers } = useApp();

  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [inputMsg, setInputMsg] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [session, setSession] = useState<AgentSession | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 初始化 Agent 会话
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      const config = await loadAgentConfig();
      const enabledSkills = await loadEnabledSkills();
      const agentServers = await loadAgentServers();
      if (!cancelled && config) {
        setSession(new AgentSession(config, agentServers, enabledSkills));
      }
    };
    init();
    return () => { cancelled = true; };
  }, [providers]);

  // 自动滚动
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 外部快捷 Prompt 填入输入框(如 Copilot 页右侧的常用 Prompt)
  useEffect(() => {
    const h = (e: Event) => setInputMsg((e as CustomEvent<string>).detail);
    window.addEventListener('agent:set-input', h);
    return () => window.removeEventListener('agent:set-input', h);
  }, []);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMsg.trim() || isRunning || !session) return;

    const userMsg: AgentMessage = {
      id: `msg_${Date.now()}`,
      sender: 'user',
      content: inputMsg.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
    setMessages(prev => [...prev, userMsg]);
    setInputMsg('');
    setIsRunning(true);

    // 占位消息用于流式更新
    const agentMsgId = `msg_agent_${Date.now()}`;
    setMessages(prev => [...prev, {
      id: agentMsgId,
      sender: 'agent' as const,
      content: '',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      streaming: true,
    }]);

    try {
      await session.sendMessage(userMsg.content, {
        onText: (text) => {
          setMessages(prev => prev.map(m => m.id === agentMsgId ? { ...m, content: text } : m));
        },
        onProposal: () => {},
        onDone: (turn) => {
          setMessages(prev => prev.map(m => m.id === agentMsgId ? {
            ...m,
            content: turn.text || '(无文本输出)',
            streaming: false,
            // 有 tool_call 就转成 Proposal 卡片
            ...(turn.toolCalls.length > 0 ? {
              proposal: {
                id: `prop_${Date.now()}`,
                command: String(turn.toolCalls[0].arguments.command || turn.toolCalls[0].name),
                tool_name: turn.toolCalls[0].name,
                server_id: turn.toolCalls[0].arguments.server_id as number || activeServerId || 1,
                safe_to_run: turn.toolCalls[0].arguments.safe_to_run as boolean | undefined,
              }
            } : {}),
          } : m));
          setIsRunning(false);
        },
        onError: (err) => {
          setMessages(prev => prev.map(m => m.id === agentMsgId ? {
            ...m, content: `错误: ${err.message}`, streaming: false
          } : m));
          setIsRunning(false);
        },
      });
    } catch (err) {
      setIsRunning(false);
    }
  };

  // 批准执行 Proposal
  const handleApprove = async (proposalId: string) => {
    if (!session) return;
    const msg = messages.find(m => m.proposal?.id === proposalId);
    if (!msg?.proposal) return;

    setMessages(prev => prev.map(m => m.proposal?.id === proposalId ? {
      ...m, proposal: { ...m.proposal!, approved: true }
    } : m));

    try {
      const result = await executeCommand(msg.proposal.server_id, msg.proposal.command, {
        source: 'agent',
        tool_name: msg.proposal.tool_name,
        approved_by: 'user',
        proposal_id: proposalId,
      });

      setMessages(prev => prev.map(m => m.proposal?.id === proposalId ? {
        ...m, proposal: { ...m.proposal!, result }
      } : m));

      // 续轮:把结果回传给 Agent 总结
      setIsRunning(true);
      const resultMsgId = `msg_agent_${Date.now()}`;
      setMessages(prev => [...prev, {
        id: resultMsgId, sender: 'agent' as const, content: '', streaming: true,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      }]);

      await session.sendMessage(
        `命令执行完成。结果:\n${result.stdout}${result.stderr ? '\n错误输出:\n' + result.stderr : ''}\n退出码:${result.exit_code}`,
        {
          onText: (text) => setMessages(prev => prev.map(m => m.id === resultMsgId ? { ...m, content: text } : m)),
          onProposal: () => {},
          onDone: () => {
            setMessages(prev => prev.map(m => m.id === resultMsgId ? { ...m, streaming: false } : m));
            setIsRunning(false);
          },
          onError: () => setIsRunning(false),
        }
      );
    } catch (err) {
      setIsRunning(false);
    }
  };

  const handleReject = (proposalId: string) => {
    setMessages(prev => prev.map(m => m.proposal?.id === proposalId ? {
      ...m, proposal: { ...m.proposal!, approved: false }
    } : m));
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
        <span style={{ color: 'var(--accent-emerald)', fontSize: compact ? 10 : 11, flexShrink: 0 }}>
          {enabledSkills.length} 项技能
        </span>
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
                ) : msg.content}

                {/* Proposal 卡片 */}
                {msg.proposal && (
                  <div style={{ marginTop: 10, background: '#070a10', border: '1px solid var(--accent-purple)', borderRadius: 8, padding: compact ? 8 : 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-purple)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Terminal size={12} /> 提议执行
                      </span>
                      <span style={{ fontSize: 10, background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: 4 }}>
                        {msg.proposal.tool_name}
                      </span>
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: compact ? 11 : 12, background: 'rgba(0,0,0,0.5)', padding: 8, borderRadius: 4, color: 'var(--accent-cyan)', marginBottom: 10, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {msg.proposal.command}
                    </div>
                    {msg.proposal.approved === undefined && (
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button className="btn btn-danger" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => handleReject(msg.proposal!.id)}>
                          <X size={12} /> 拒绝
                        </button>
                        <button className="btn btn-primary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => handleApprove(msg.proposal!.id)}>
                          <Check size={12} /> 批准执行
                        </button>
                      </div>
                    )}
                    {msg.proposal.approved === true && (
                      <div style={{ color: 'var(--accent-emerald)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Check size={14} /> 已批准并执行
                      </div>
                    )}
                    {msg.proposal.approved === false && (
                      <div style={{ color: 'var(--accent-rose)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <X size={14} /> 已拒绝执行
                      </div>
                    )}
                    {msg.proposal.result && (
                      <div style={{ marginTop: 8, fontSize: 11, background: '#020305', padding: 8, borderRadius: 4, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', maxHeight: 100, overflowY: 'auto' }}>
                        {msg.proposal.result.stdout}
                      </div>
                    )}
                  </div>
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
    </div>
  );
};
