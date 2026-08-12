import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import * as ipc from '../lib/ipc';
import type { AgentProposal, AgentMessage } from '../context/AppContext';
import {
  History, Search, Trash2, ArrowRight, Bot, User, Terminal,
  FileText, Check, X, MessageSquare, Clock,
} from 'lucide-react';

/**
 * Agent 对话记忆(历史会话档案馆)
 *
 * 与 AgentCopilot(实时对话)职责分离:
 * - 这里是只读浏览 + 管理入口(搜索/预览/删除/继续对话)
 * - "继续对话"跳转到 Agent Copilot 并选中该会话
 */
export const AgentMemory: React.FC = () => {
  const { agentSessions, deleteAgentSession, servers, setActiveView } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [msgCounts, setMsgCounts] = useState<Record<string, number>>({});

  // 确认删除 3 秒复位
  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(null), 3000);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  // 搜索过滤(按标题模糊匹配)
  const filtered = agentSessions.filter(s => {
    if (!searchQuery.trim()) return true;
    return (s.title || '').toLowerCase().includes(searchQuery.toLowerCase());
  });

  // 选中会话时加载消息
  useEffect(() => {
    if (!selectedId) { setMessages([]); return; }
    let cancelled = false;
    setLoadingMessages(true);
    (async () => {
      try {
        const stored = await ipc.loadAgentMessages(selectedId);
        if (cancelled) return;
        setMessages(stored.map(s => ({
          id: s.id,
          sender: s.sender as 'user' | 'agent' | 'system',
          content: s.content,
          timestamp: s.timestamp,
          proposal: s.proposal as AgentProposal | undefined,
        })));
      } catch { /* */ }
      finally { if (!cancelled) setLoadingMessages(false); }
    })();
    return () => { cancelled = true; };
  }, [selectedId]);

  // 加载各会话消息数(轻量统计,用于列表展示)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const counts: Record<string, number> = {};
      for (const s of agentSessions.slice(0, 50)) { // 最多查前 50 个
        try {
          const msgs = await ipc.loadAgentMessages(s.id);
          counts[s.id] = msgs.length;
        } catch { counts[s.id] = 0; }
      }
      if (!cancelled) setMsgCounts(counts);
    })();
    return () => { cancelled = true; };
  }, [agentSessions]);

  const handleDelete = async (id: string) => {
    if (confirmDelete !== id) { setConfirmDelete(id); return; }
    setConfirmDelete(null);
    if (selectedId === id) setSelectedId(null);
    await deleteAgentSession(id);
  };

  const handleContinue = (id: string) => {
    localStorage.setItem('agent_active_session', id);
    setActiveView('agent');
  };

  const selectedSession = agentSessions.find(s => s.id === selectedId);
  const serverName = (sid: number | null) => servers.find(s => s.id === sid)?.name;

  return (
    <div>
      <div className="page-title-row">
        <div>
          <h2 className="page-title">
            <History size={24} style={{ color: 'var(--accent-purple)' }} />
            对话记忆 (Agent Memory)
          </h2>
          <p className="page-subtitle">浏览、搜索与管理 Agent 历史对话。点击"继续对话"可恢复上下文回到 Agent Copilot。</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16, minHeight: 'calc(100vh - 200px)' }}>
        {/* 左侧:搜索 + 会话列表 */}
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', padding: 12, minHeight: 0 }}>
          {/* 搜索框 */}
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
            <input
              className="input-field"
              style={{ height: 32, fontSize: 12, paddingLeft: 32 }}
              placeholder="搜索对话标题…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          {/* 会话列表 */}
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filtered.length === 0 && (
              <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-dim)', fontSize: 12 }}>
                <MessageSquare size={28} style={{ marginBottom: 8, opacity: 0.3 }} />
                <div>{searchQuery ? '没有匹配的对话' : '暂无历史对话'}</div>
              </div>
            )}
            {filtered.map(s => {
              const isActive = selectedId === s.id;
              const confirming = confirmDelete === s.id;
              const msgCount = msgCounts[s.id];
              return (
                <div
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  style={{
                    padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                    background: isActive ? 'rgba(139, 92, 246, 0.12)' : 'rgba(0,0,0,0.2)',
                    border: `1px solid ${isActive ? 'rgba(139, 92, 246, 0.3)' : 'var(--border-color)'}`,
                    transition: 'background 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 12, fontWeight: 600, marginBottom: 4,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {s.title || '(未命名)'}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: 'var(--text-dim)' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          <Clock size={10} /> {new Date(s.updated_at).toLocaleDateString()}
                        </span>
                        {msgCount !== undefined && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                            <MessageSquare size={10} /> {msgCount}
                          </span>
                        )}
                        {s.server_id && serverName(s.server_id) && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--accent-cyan)' }}>
                            {serverName(s.server_id)}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      style={{
                        background: confirming ? 'var(--accent-rose)' : 'transparent',
                        border: 'none', cursor: 'pointer', padding: 4, borderRadius: 4,
                        color: confirming ? '#fff' : 'var(--text-dim)', flexShrink: 0,
                      }}
                      onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
                      title={confirming ? '再次点击确认删除' : '删除'}
                    >
                      {confirming ? <X size={12} /> : <Trash2 size={12} />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 右侧:消息预览 */}
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', padding: 16, minHeight: 0 }}>
          {!selectedId ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12 }}>
              <History size={48} style={{ opacity: 0.15 }} />
              <div style={{ fontSize: 14, color: 'var(--text-dim)' }}>
                {agentSessions.length > 0 ? '选择左侧对话查看完整内容' : '还没有任何对话记录'}
              </div>
            </div>
          ) : (
            <>
              {/* 顶部操作栏 */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                paddingBottom: 12, marginBottom: 12, borderBottom: '1px solid var(--border-color)',
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{selectedSession?.title || '(未命名)'}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                    {selectedSession && serverName(selectedSession.server_id) && `服务器: ${serverName(selectedSession.server_id)} · `}
                    {messages.length} 条消息 · {selectedSession && new Date(selectedSession.updated_at).toLocaleString()}
                  </div>
                </div>
                <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => handleContinue(selectedId)}>
                  继续对话 <ArrowRight size={14} />
                </button>
              </div>

              {/* 消息列表 */}
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {loadingMessages && (
                  <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-dim)', fontSize: 12 }}>加载中…</div>
                )}
                {messages.map(msg => (
                  <MessagePreview key={msg.id} msg={msg} />
                ))}
                {messages.length === 0 && !loadingMessages && (
                  <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-dim)', fontSize: 12 }}>
                    这个对话还没有消息
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

/** 单条消息预览(只读) */
const MessagePreview: React.FC<{ msg: AgentMessage }> = ({ msg }) => {
  const isUser = msg.sender === 'user';
  return (
    <div style={{ alignSelf: isUser ? 'flex-end' : 'flex-start', maxWidth: '80%', display: 'flex', gap: 8 }}>
      {!isUser && (
        <div style={{
          background: 'var(--accent-purple)', color: '#fff', width: 26, height: 26,
          borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Bot size={14} />
        </div>
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{
          background: isUser ? 'rgba(6, 182, 212, 0.15)' : 'rgba(255, 255, 255, 0.04)',
          border: '1px solid',
          borderColor: isUser ? 'rgba(6, 182, 212, 0.25)' : 'var(--border-color)',
          padding: '10px 14px', borderRadius: 10,
          fontSize: 13, lineHeight: 1.6, wordBreak: 'break-word',
        }}>
          <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content || '(空)'}</div>

          {/* Proposal 卡片(只读) */}
          {msg.proposal && (
            <div style={{
              marginTop: 10, background: '#070a10',
              border: '1px solid var(--accent-purple)', borderRadius: 8, padding: 10,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-purple)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {msg.proposal.tool_name === 'write_file' ? <FileText size={11} /> : <Terminal size={11} />}
                  {msg.proposal.tool_name === 'write_file' ? '写入文件' : '执行命令'}
                </span>
                <span style={{ fontSize: 10 }}>
                  {msg.proposal.approved === true && <span style={{ color: 'var(--accent-emerald)' }}><Check size={11} /> 已执行</span>}
                  {msg.proposal.approved === false && <span style={{ color: 'var(--accent-rose)' }}><X size={11} /> 已拒绝</span>}
                  {msg.proposal.approved === undefined && <span style={{ color: 'var(--text-dim)' }}>待审批</span>}
                </span>
              </div>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 11,
                background: 'rgba(0,0,0,0.5)', padding: 6, borderRadius: 4,
                color: 'var(--accent-cyan)', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              }}>
                {msg.proposal.command}
              </div>
              {msg.proposal.result && (
                <div style={{
                  marginTop: 6, fontSize: 10, background: '#020305', padding: 6, borderRadius: 4,
                  color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
                  maxHeight: 80, overflowY: 'auto', whiteSpace: 'pre-wrap',
                }}>
                  {msg.proposal.result.stdout}
                </div>
              )}
            </div>
          )}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 3, textAlign: isUser ? 'right' : 'left' }}>
          {msg.timestamp}
        </div>
      </div>
      {isUser && (
        <div style={{
          background: 'rgba(6, 182, 212, 0.3)', color: 'var(--accent-cyan)', width: 26, height: 26,
          borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <User size={14} />
        </div>
      )}
    </div>
  );
};
