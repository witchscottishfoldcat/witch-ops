import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { Bot, Sparkles, BookOpen, Plus, MessageSquare, Trash2, X } from 'lucide-react';
import { AgentChatPanel } from './AgentChatPanel';
import * as ipc from '../lib/ipc';
import type { AgentSessionInfo } from '../lib/ipc';

/**
 * Agent 智能运维 Copilot(全页)
 *
 * 左侧:历史会话列表 + 新建对话
 * 右侧:对话面板 + SOP 技能信息栏
 */
export const AgentCopilot: React.FC = () => {
  const { skills, activeServerId } = useApp();
  const enabledSkills = skills.filter(s => s.enabled);

  const [sessions, setSessions] = useState<AgentSessionInfo[]>([]);
  // activeSessionId 持久化到 localStorage:切走再回来自动恢复上次对话
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => {
    return localStorage.getItem('agent_active_session');
  });
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const selectSession = useCallback((id: string | null) => {
    setActiveSessionId(id);
    if (id) localStorage.setItem('agent_active_session', id);
    else localStorage.removeItem('agent_active_session');
  }, []);

  const refreshSessions = useCallback(async () => {
    try { setSessions(await ipc.listAgentSessions()); } catch { /* */ }
  }, []);

  useEffect(() => { refreshSessions(); }, [refreshSessions]);

  // 挂载时如果没有选中会话:自动选中最近的会话(无缝恢复)
  useEffect(() => {
    if (activeSessionId) return; // 已有选中,不干预
    refreshSessions().then(() => {
      // 读最新列表,选中第一条
      ipc.listAgentSessions().then(list => {
        if (list.length > 0 && !localStorage.getItem('agent_active_session')) {
          selectSession(list[0].id);
        }
      }).catch(() => {});
    });
  }, []); // 仅挂载时执行一次

  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(null), 3000);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  const handleNewSession = async () => {
    try {
      const id = await ipc.createAgentSession(
        `对话 ${new Date().toLocaleString()}`,
        activeServerId ?? undefined,
      );
      await refreshSessions();
      selectSession(id);
    } catch { /* */ }
  };

  const handleDelete = async (id: string) => {
    if (confirmDelete !== id) { setConfirmDelete(id); return; }
    setConfirmDelete(null);
    try {
      await ipc.deleteAgentSession(id);
      if (activeSessionId === id) selectSession(null);
      await refreshSessions();
    } catch { /* */ }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 92px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 className="page-title">
            <Bot size={24} style={{ color: 'var(--accent-purple)' }} />
            Witchcat Agent 智能运维 Copilot
          </h2>
          <p className="page-subtitle">对话自动持久化,支持历史会话回看。融合 SOP 技能库协助排查分析。</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr 260px', gap: 12, flex: 1, minHeight: 0 }}>
        {/* 左侧:会话列表 */}
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', padding: 10, minHeight: 0 }}>
          <button className="btn btn-primary" style={{ fontSize: 12, marginBottom: 10 }} onClick={handleNewSession}>
            <Plus size={14} /> 新建对话
          </button>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {sessions.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', padding: 20 }}>
                暂无历史对话
              </div>
            )}
            {sessions.map(s => (
              <div
                key={s.id}
                onClick={() => selectSession(s.id)}
                style={{
                  padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                  background: activeSessionId === s.id ? 'rgba(139, 92, 246, 0.15)' : 'rgba(0,0,0,0.2)',
                  border: `1px solid ${activeSessionId === s.id ? 'rgba(139, 92, 246, 0.3)' : 'var(--border-color)'}`,
                  display: 'flex', alignItems: 'center', gap: 6, transition: 'background 0.15s',
                }}
              >
                <MessageSquare size={13} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.title || '(未命名)'}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>
                    {new Date(s.updated_at).toLocaleDateString()}
                  </div>
                </div>
                <button
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer', padding: 2,
                    color: confirmDelete === s.id ? '#fff' : 'var(--text-dim)',
                  }}
                  onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
                  title="删除对话"
                >
                  {confirmDelete === s.id ? <X size={12} /> : <Trash2 size={11} />}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* 中间:聊天区 */}
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', padding: 16, minHeight: 0 }}>
          {activeSessionId ? (
            <AgentChatPanel key={activeSessionId} sessionId={activeSessionId} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12 }}>
              <Bot size={48} style={{ opacity: 0.2 }} />
              <div style={{ fontSize: 14, color: 'var(--text-dim)' }}>选择左侧对话或点击"新建对话"开始</div>
              <button className="btn btn-primary" onClick={handleNewSession}>
                <Plus size={14} /> 新建对话
              </button>
            </div>
          )}
        </div>

        {/* 右侧:技能信息栏 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
          <div className="glass-card" style={{ padding: 12 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Sparkles size={14} style={{ color: 'var(--accent-cyan)' }} /> 常用 SRE 运维 Prompt
            </h3>
            <PromptList />
          </div>
          <div className="glass-card" style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <BookOpen size={14} style={{ color: 'var(--accent-purple)' }} /> 启用的 SOP 技能
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {enabledSkills.map(s => (
                <div key={s.id} style={{ background: 'rgba(0,0,0,0.3)', padding: 8, borderRadius: 6, border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-main)' }}>{s.title}</div>
                </div>
              ))}
              {enabledSkills.length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>暂无启用的技能</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/** 常用 Prompt 列表 */
const PromptList: React.FC = () => {
  const prompts = [
    '检查网关 Nginx 错误日志与 502 根因',
    '扫描生产服务器磁盘占用与大文件',
    '确认 Kubernetes Node Ready 节点状态',
    '查询数据库 PostgreSQL 慢查询日志',
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {prompts.map((p, idx) => (
        <button
          key={idx}
          className="btn btn-secondary"
          style={{ textAlign: 'left', fontSize: 11, padding: 8 }}
          onClick={() => window.dispatchEvent(new CustomEvent('agent:set-input', { detail: p }))}
        >
          {p}
        </button>
      ))}
    </div>
  );
};
