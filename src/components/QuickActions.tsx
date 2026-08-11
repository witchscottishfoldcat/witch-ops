import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { QuickActionStep } from '../types/backend';
import { Zap, Play, Trash2, ArrowRight, AlertTriangle, Check, X } from 'lucide-react';

/** 安全解析 JSON 字符串字段,失败返回 null(避免渲染期 JSON.parse 抛异常白屏) */
function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

export const QuickActions: React.FC = () => {
  const {
    quickActions, runQuickAction, deleteQuickAction, activeServerId, servers,
    pendingQuickAction, confirmQuickAction, cancelQuickAction,
  } = useApp();
  const [runningId, setRunningId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleRun = async (actionId: string) => {
    if (!activeServerId) return;
    setRunningId(actionId);
    try {
      await runQuickAction(actionId, activeServerId);
    } finally {
      setRunningId(null);
    }
  };

  const handleDelete = (id: string) => {
    if (confirmDeleteId === id) {
      setConfirmDeleteId(null);
      deleteQuickAction(id);
    } else {
      setConfirmDeleteId(id);
    }
  };

  const currentServer = servers.find(s => s.id === activeServerId);

  return (
    <div>
      <div className="page-title-row">
        <div>
          <h2 className="page-title">
            <Zap size={24} style={{ color: 'var(--accent-cyan)' }} />
            快捷指令编排 (Quick Actions - 需求2-B)
          </h2>
          <p className="page-subtitle">一键执行多步骤运维 Command 链，包含变量捕获 (Capture)、Guard 条件校验与 Confirm 操作推测。</p>
        </div>
      </div>

      <div style={{ background: 'rgba(6, 182, 212, 0.1)', border: '1px solid rgba(6, 182, 212, 0.2)', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 20 }}>
        当前目标服务器: <strong>{currentServer?.name || '未选择'}</strong> ({currentServer?.host})
      </div>

      {/* Quick Action List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {quickActions.map(action => {
          const steps: QuickActionStep[] = safeParse<QuickActionStep[]>(action.steps) ?? [];

          return (
            <div key={action.id} className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ flex: 1, paddingRight: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <Zap size={18} style={{ color: 'var(--accent-cyan)' }} />
                  <h3 style={{ fontSize: 16, fontWeight: 700 }}>{action.name}</h3>
                  <span className="badge" style={{ background: 'rgba(255,255,255,0.1)', color: 'var(--text-muted)' }}>
                    {action.approval === 'always_approve' ? '自动核准' : action.approval === 'auto_review' ? 'Auto Review' : '需要二次确认'}
                  </span>
                </div>

                {/* Steps Chain Visualizer */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {steps.map((st, idx) => (
                    <React.Fragment key={idx}>
                      <div style={{
                        background: '#04060a',
                        border: '1px solid var(--border-color)',
                        padding: '6px 10px',
                        borderRadius: 6,
                        fontFamily: 'var(--font-mono)',
                        fontSize: 12,
                        color: 'var(--accent-cyan)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                      }}>
                        <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>Step {idx + 1}:</span>
                        <span>{st.value}</span>
                        {st.capture && <span style={{ background: 'rgba(139, 92, 246, 0.2)', color: 'var(--accent-purple)', fontSize: 10, padding: '1px 4px', borderRadius: 3 }}>⇒ {st.capture}</span>}
                        {st.guard && <span style={{ background: 'rgba(245, 158, 11, 0.15)', color: 'var(--accent-amber)', fontSize: 10, padding: '1px 4px', borderRadius: 3 }}>Guard</span>}
                        {st.confirm && <span style={{ color: 'var(--accent-amber)', fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 3 }}><AlertTriangle size={10} /> Confirm</span>}
                      </div>

                      {idx < steps.length - 1 && (
                        <ArrowRight size={14} style={{ color: 'var(--text-dim)' }} />
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <button
                  className="btn btn-primary"
                  style={{ minWidth: 120, justifyContent: 'center' }}
                  onClick={() => handleRun(action.id)}
                  disabled={runningId === action.id || !activeServerId}
                  title={activeServerId ? undefined : '请先选择目标服务器'}
                >
                  {runningId === action.id ? (
                    <span>执行中...</span>
                  ) : (
                    <>
                      <Play size={14} /> 触发执行
                    </>
                  )}
                </button>

                <button
                  className={`btn ${confirmDeleteId === action.id ? 'btn-danger' : 'btn-secondary'}`}
                  style={{ padding: 8, color: 'var(--accent-rose)' }}
                  onClick={() => handleDelete(action.id)}
                  title={confirmDeleteId === action.id ? '再次点击确认删除' : '删除'}
                >
                  {confirmDeleteId === action.id ? <Check size={14} /> : <Trash2 size={14} />}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 快捷指令审批确认弹窗(approval=always_ask 或步骤带 confirm 时触发) */}
      {pendingQuickAction && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: 560 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{ background: 'rgba(245, 158, 11, 0.2)', padding: 10, borderRadius: '50%', color: 'var(--accent-amber)' }}>
                <AlertTriangle size={24} />
              </div>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>确认执行快捷指令</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  <strong>{pendingQuickAction.actionName}</strong> → 服务器{' '}
                  <strong>{pendingQuickAction.serverName}</strong>
                </p>
              </div>
            </div>

            <p style={{ fontSize: 13, color: 'var(--text-main)', marginBottom: 12 }}>
              将依次执行以下 {pendingQuickAction.commands.length} 条命令(均记入审计日志):
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflowY: 'auto', marginBottom: 20 }}>
              {pendingQuickAction.commands.map((c, i) => (
                <div key={i} style={{
                  background: '#04060a', border: '1px solid var(--border-color)', borderRadius: 6,
                  padding: '8px 10px', fontFamily: 'var(--font-mono)', fontSize: 12,
                  color: 'var(--accent-cyan)', wordBreak: 'break-all',
                }}>
                  <span style={{ color: 'var(--text-dim)', fontSize: 10, marginRight: 6 }}>#{i + 1}</span>
                  {c.value}
                  {c.needsConfirm && (
                    <span style={{ marginLeft: 8, color: 'var(--accent-amber)', fontSize: 10 }}>⚠ 高危</span>
                  )}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button className="btn btn-secondary" onClick={cancelQuickAction}>
                <X size={14} /> 取消
              </button>
              <button className="btn btn-primary" onClick={confirmQuickAction}>
                <Check size={14} /> 确认执行
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
