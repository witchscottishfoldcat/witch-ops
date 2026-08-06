import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { QuickActionStep } from '../types/backend';
import { Zap, Play, Trash2, ArrowRight, AlertTriangle } from 'lucide-react';

export const QuickActions: React.FC = () => {
  const { quickActions, runQuickAction, deleteQuickAction, activeServerId, servers } = useApp();
  const [runningId, setRunningId] = useState<string | null>(null);

  const handleRun = async (actionId: string) => {
    if (!activeServerId) return;
    setRunningId(actionId);
    await runQuickAction(actionId, activeServerId);
    setTimeout(() => setRunningId(null), 800);
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
          const steps: QuickActionStep[] = action.steps ? JSON.parse(action.steps) : [];

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
                  disabled={runningId === action.id}
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
                  className="btn btn-secondary"
                  style={{ padding: 8, color: 'var(--accent-rose)' }}
                  onClick={() => deleteQuickAction(action.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
