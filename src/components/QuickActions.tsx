import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { QuickAction, QuickActionStep } from '../types/backend';
import { Zap, Play, Trash2, ArrowRight, AlertTriangle, Check, X, Plus, Edit } from 'lucide-react';

/** 安全解析 JSON 字符串字段 */
function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

const EMPTY_ACTION: QuickAction = {
  id: '',
  name: '',
  icon: null,
  target: null,
  steps: JSON.stringify([{ type: 'command', value: '' }]),
  approval: 'always_ask',
  audit: true,
  created_at: '',
  updated_at: '',
};

export const QuickActions: React.FC = () => {
  const {
    quickActions, runQuickAction, deleteQuickAction, upsertQuickAction,
    activeServerId, servers,
    pendingQuickAction, confirmQuickAction, cancelQuickAction,
  } = useApp();
  const [runningId, setRunningId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingAction, setEditingAction] = useState<QuickAction | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!confirmDeleteId) return;
    const t = setTimeout(() => setConfirmDeleteId(null), 3000);
    return () => clearTimeout(t);
  }, [confirmDeleteId]);

  const handleRun = async (actionId: string) => {
    if (!activeServerId) return;
    setRunningId(actionId);
    try { await runQuickAction(actionId, activeServerId); }
    finally { setRunningId(null); }
  };

  const handleDelete = (id: string) => {
    if (confirmDeleteId === id) { setConfirmDeleteId(null); deleteQuickAction(id); }
    else { setConfirmDeleteId(id); }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAction) return;
    if (!editingAction.name.trim()) return;
    setSaving(true);
    try {
      const toSave: QuickAction = {
        ...editingAction,
        id: editingAction.id || `qa_${Date.now()}`,
        created_at: editingAction.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await upsertQuickAction(toSave);
      setEditingAction(null);
    } catch { /* toast 已提示 */ }
    finally { setSaving(false); }
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
          <p className="page-subtitle">一键执行多步骤运维 Command 链，支持 Guard 条件校验与 Confirm 确认。</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditingAction({ ...EMPTY_ACTION })}>
          <Plus size={16} /> 新建快捷指令
        </button>
      </div>

      <div style={{ background: 'rgba(6, 182, 212, 0.1)', border: '1px solid rgba(6, 182, 212, 0.2)', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 20 }}>
        当前目标服务器: <strong>{currentServer?.name || '未选择'}</strong> ({currentServer?.host})
      </div>

      {/* 快捷指令列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {quickActions.length === 0 && (
          <div className="glass-card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-dim)' }}>
            <Zap size={32} style={{ marginBottom: 8, opacity: 0.3 }} />
            <div style={{ fontSize: 13 }}>还没有快捷指令。点击右上角"新建快捷指令"创建第一个。</div>
          </div>
        )}
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {steps.map((st, idx) => (
                    <React.Fragment key={idx}>
                      <div style={{
                        background: '#04060a', border: '1px solid var(--border-color)',
                        padding: '6px 10px', borderRadius: 6, fontFamily: 'var(--font-mono)',
                        fontSize: 12, color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center', gap: 6,
                      }}>
                        <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>{idx + 1}.</span>
                        <span>{st.value}</span>
                        {st.guard && <span style={{ background: 'rgba(245, 158, 11, 0.15)', color: 'var(--accent-amber)', fontSize: 10, padding: '1px 4px', borderRadius: 3 }}>Guard</span>}
                        {st.confirm && <span style={{ color: 'var(--accent-amber)', fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 3 }}><AlertTriangle size={10} /> Confirm</span>}
                      </div>
                      {idx < steps.length - 1 && <ArrowRight size={14} style={{ color: 'var(--text-dim)' }} />}
                    </React.Fragment>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <button className="btn btn-primary" style={{ minWidth: 100, justifyContent: 'center' }}
                  onClick={() => handleRun(action.id)}
                  disabled={runningId === action.id || !activeServerId}
                  title={activeServerId ? undefined : '请先选择目标服务器'}>
                  {runningId === action.id ? '执行中...' : <><Play size={14} /> 执行</>}
                </button>
                <button className="btn btn-secondary" style={{ padding: 8 }} onClick={() => setEditingAction(action)}>
                  <Edit size={14} />
                </button>
                <button className={`btn ${confirmDeleteId === action.id ? 'btn-danger' : 'btn-secondary'}`}
                  style={{ padding: 8, color: 'var(--accent-rose)' }}
                  onClick={() => handleDelete(action.id)}
                  title={confirmDeleteId === action.id ? '再次点击确认删除' : '删除'}>
                  {confirmDeleteId === action.id ? <Check size={14} /> : <Trash2 size={14} />}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 编辑/新建快捷指令表单 */}
      {editingAction && (
        <QuickActionEditor
          action={editingAction}
          onChange={setEditingAction}
          onSave={handleSave}
          onCancel={() => setEditingAction(null)}
          saving={saving}
        />
      )}

      {/* 审批确认弹窗 */}
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
                  <strong>{pendingQuickAction.actionName}</strong> → 服务器 <strong>{pendingQuickAction.serverName}</strong>
                </p>
              </div>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-main)', marginBottom: 12 }}>
              将依次执行以下 {pendingQuickAction.commands.length} 条命令:
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
                  {c.needsConfirm && <span style={{ marginLeft: 8, color: 'var(--accent-amber)', fontSize: 10 }}>⚠ 高危</span>}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button className="btn btn-secondary" onClick={cancelQuickAction}><X size={14} /> 取消</button>
              <button className="btn btn-primary" onClick={confirmQuickAction}><Check size={14} /> 确认执行</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ==================== 快捷指令编辑器 ====================

const QuickActionEditor: React.FC<{
  action: QuickAction;
  onChange: (a: QuickAction) => void;
  onSave: (e: React.FormEvent) => void;
  onCancel: () => void;
  saving: boolean;
}> = ({ action, onChange, onSave, onCancel, saving }) => {
  const steps: QuickActionStep[] = safeParse<QuickActionStep[]>(action.steps) ?? [];

  const updateStep = (idx: number, patch: Partial<QuickActionStep>) => {
    const next = steps.map((s, i) => i === idx ? { ...s, ...patch } : s);
    onChange({ ...action, steps: JSON.stringify(next) });
  };
  const addStep = () => {
    onChange({ ...action, steps: JSON.stringify([...steps, { type: 'command', value: '' }]) });
  };
  const removeStep = (idx: number) => {
    onChange({ ...action, steps: JSON.stringify(steps.filter((_, i) => i !== idx)) });
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ width: 640, maxWidth: '90vw' }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>
          {action.id ? '编辑快捷指令' : '新建快捷指令'}
        </h3>
        <form onSubmit={onSave} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>指令名称</label>
            <input className="input-field" value={action.name}
              onChange={e => onChange({ ...action, name: e.target.value })} required autoFocus />
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>审批策略</label>
              <select className="input-field" value={action.approval}
                onChange={e => onChange({ ...action, approval: e.target.value as QuickAction['approval'] })}>
                <option value="always_ask" style={{ background: '#10141e' }}>需要二次确认(每次弹窗)</option>
                <option value="auto_review" style={{ background: '#10141e' }}>Auto Review(自动审查)</option>
                <option value="always_approve" style={{ background: '#10141e' }}>自动核准(不弹窗)</option>
              </select>
            </div>
          </div>

          {/* 步骤列表 */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>执行步骤</label>
              <button type="button" className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={addStep}>
                <Plus size={12} /> 添加步骤
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {steps.map((step, idx) => (
                <div key={idx} style={{
                  background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-color)',
                  borderRadius: 6, padding: 10,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Step {idx + 1}</span>
                    {steps.length > 1 && (
                      <button type="button" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--accent-rose)' }}
                        onClick={() => removeStep(idx)}>
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                  <input className="input-field" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, marginBottom: 6 }}
                    placeholder="要执行的命令,如 systemctl restart nginx"
                    value={step.value} onChange={e => updateStep(idx, { value: e.target.value })} />
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 120 }}>
                      <label style={{ fontSize: 10, color: 'var(--text-dim)' }}>Guard 前置检查命令(可选,失败则中止)</label>
                      <input className="input-field" style={{ fontSize: 11, height: 28 }}
                        placeholder="如 test -f /etc/nginx/nginx.conf"
                        value={step.guard ?? ''} onChange={e => updateStep(idx, { guard: e.target.value || undefined })} />
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--accent-amber)', alignSelf: 'flex-end', paddingBottom: 6, cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!step.confirm}
                        onChange={e => updateStep(idx, { confirm: e.target.checked || undefined })} />
                      <AlertTriangle size={11} /> 标记高危
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>取消</button>
            <button type="submit" className="btn btn-primary" disabled={saving || !action.name.trim()}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
