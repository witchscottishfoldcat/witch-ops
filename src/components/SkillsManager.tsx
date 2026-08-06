import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Skill } from '../types/backend';
import { BookOpen, Plus, ToggleLeft, ToggleRight, Edit, Trash2 } from 'lucide-react';

export const SkillsManager: React.FC = () => {
  const { skills, upsertSkill, toggleSkill, deleteSkill } = useApp();
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [showModal, setShowModal] = useState(false);

  const handleOpenAdd = () => {
    setEditingSkill({
      id: `skill_${Date.now()}`,
      title: '',
      content: `# 运维 SOP 指南\n1. **步骤一**: ...`,
      triggers: JSON.stringify(['custom_trigger']),
      tags: JSON.stringify(['sop']),
      applies_to: null,
      risk_level: 'low',
      enabled: true,
      source: 'manual',
      source_doc_id: null,
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    setShowModal(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingSkill) {
      upsertSkill(editingSkill);
      setShowModal(false);
      setEditingSkill(null);
    }
  };

  return (
    <div>
      <div className="page-title-row">
        <div>
          <h2 className="page-title">
            <BookOpen size={24} style={{ color: 'var(--accent-purple)' }} />
            SOP 运维技能库 (Skills - 需求2-A)
          </h2>
          <p className="page-subtitle">定义 Agent 可调用的运维标准处置流程，按风险等级进行分类管控，支撑智能问答与自动修复。</p>
        </div>

        <button className="btn btn-primary" onClick={handleOpenAdd}>
          <Plus size={16} /> 新建 SOP 技能
        </button>
      </div>

      {/* Skills Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
        {skills.map(skill => {
          const triggers: string[] = skill.triggers ? JSON.parse(skill.triggers) : [];
          const tags: string[] = skill.tags ? JSON.parse(skill.tags) : [];

          return (
            <div key={skill.id} className="glass-card" style={{ display: 'flex', flexDirection: 'column', opacity: skill.enabled ? 1 : 0.6 }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 700 }}>{skill.title}</h3>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                    ID: {skill.id} | v{skill.version} | 来源: {skill.source === 'from_doc' ? '文档转化' : '人工编写'}
                  </div>
                </div>

                {/* Risk & Toggle */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`badge badge-risk-${skill.risk_level}`}>
                    {skill.risk_level === 'high' ? '高危' : skill.risk_level === 'medium' ? '中危' : '低危'}
                  </span>
                  <button
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: skill.enabled ? 'var(--accent-emerald)' : 'var(--text-dim)' }}
                    onClick={() => toggleSkill(skill.id, !skill.enabled)}
                    title={skill.enabled ? '点击禁用此技能' : '点击启用此技能'}
                  >
                    {skill.enabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                  </button>
                </div>
              </div>

              {/* Triggers */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>触发关键词 (Triggers):</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {triggers.map(tr => (
                    <span key={tr} style={{ background: 'rgba(139, 92, 246, 0.15)', color: 'var(--accent-purple)', fontSize: 11, padding: '2px 6px', borderRadius: 4 }}>
                      #{tr}
                    </span>
                  ))}
                </div>
              </div>

              {/* Content Snippet */}
              <div style={{
                background: '#04060a',
                border: '1px solid var(--border-color)',
                borderRadius: 6,
                padding: 10,
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                color: '#d1d5db',
                flex: 1,
                maxHeight: 120,
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
                marginBottom: 12
              }}>
                {skill.content}
              </div>

              {/* Footer */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  {tags.map(t => (
                    <span key={t} style={{ background: 'rgba(255,255,255,0.06)', fontSize: 10, padding: '1px 5px', borderRadius: 3, color: 'var(--text-dim)' }}>
                      {t}
                    </span>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: 4 }}
                    onClick={() => {
                      setEditingSkill(skill);
                      setShowModal(true);
                    }}
                  >
                    <Edit size={14} />
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: 4, color: 'var(--accent-rose)' }}
                    onClick={() => deleteSkill(skill.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Edit/Add Skill Modal */}
      {showModal && editingSkill && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: 600 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>
              {editingSkill.id ? '编辑 SOP 技能' : '新建 SOP 技能'}
            </h3>
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>技能 Slug / ID</label>
                <input
                  className="input-field"
                  value={editingSkill.id}
                  onChange={e => setEditingSkill({ ...editingSkill, id: e.target.value })}
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>技能标题</label>
                <input
                  className="input-field"
                  value={editingSkill.title}
                  onChange={e => setEditingSkill({ ...editingSkill, title: e.target.value })}
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>风险等级</label>
                  <select
                    className="input-field"
                    value={editingSkill.risk_level}
                    onChange={e => setEditingSkill({ ...editingSkill, risk_level: e.target.value as any })}
                  >
                    <option value="low" style={{ background: '#10141e' }}>低风险 (Low)</option>
                    <option value="medium" style={{ background: '#10141e' }}>中风险 (Medium)</option>
                    <option value="high" style={{ background: '#10141e' }}>高风险 (High)</option>
                  </select>
                </div>

                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>触发词 (JSON 数组)</label>
                  <input
                    className="input-field"
                    value={editingSkill.triggers || ''}
                    onChange={e => setEditingSkill({ ...editingSkill, triggers: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>SOP 内容 (Markdown 规则与步骤)</label>
                <textarea
                  className="input-field"
                  rows={8}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                  value={editingSkill.content}
                  onChange={e => setEditingSkill({ ...editingSkill, content: e.target.value })}
                  required
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>取消</button>
                <button type="submit" className="btn btn-primary">保存技能</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
