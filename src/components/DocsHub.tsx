import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { Doc } from '../types/backend';
import { FileCode, Sparkles, BookOpen, CheckCircle, Trash2, Eye, ArrowRight, Flame, FileText, Bot, User, X } from 'lucide-react';

export const DocsHub: React.FC = () => {
  const { docs, updateDocStatus, deleteDoc, convertDocToSkill } = useApp();
  const [selectedType, setSelectedType] = useState<string>('all');
  const [activeDoc, setActiveDoc] = useState<Doc | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // 两步确认:3 秒后自动复位
  useEffect(() => {
    if (!confirmDeleteId) return;
    const t = setTimeout(() => setConfirmDeleteId(null), 3000);
    return () => clearTimeout(t);
  }, [confirmDeleteId]);

  const filteredDocs = docs.filter(d => {
    if (selectedType === 'all') return true;
    return d.type === selectedType;
  });

  return (
    <div>
      <div className="page-title-row">
        <div>
          <h2 className="page-title">
            <FileCode size={24} style={{ color: 'var(--accent-pink)' }} />
            文档沉淀与经验飞轮 (Documentation & Flywheel - 需求3)
          </h2>
          <p className="page-subtitle">沉淀变更记录、事故复盘与 SOP 文档。经过审核后的文档可一键转换存入 SOP 技能库，闭环注入 Agent 系统提示。</p>
        </div>
      </div>

      {/* Flywheel Architecture Card */}
      <div className="glass-card" style={{ marginBottom: 20, background: 'linear-gradient(135deg, rgba(236, 72, 153, 0.1), rgba(139, 92, 246, 0.1))', borderColor: 'rgba(236, 72, 153, 0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12 }}>
            <Sparkles size={28} style={{ color: 'var(--accent-pink)' }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>经验飞轮数据闭环 (Experience Flywheel)</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span>Agent 执行操作写审计日志</span>
                <ArrowRight size={12} />
                <span>会话结束生成复盘文档</span>
                <ArrowRight size={12} />
                <span>审核后点“存为技能”(`doc_to_skill`)</span>
                <ArrowRight size={12} />
                <span>注入系统提示</span>
                <ArrowRight size={12} />
                <span>下次 Agent 自动调用</span>
              </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Category Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['all', 'postmortem', 'change_record', 'sop'].map(t => (
          <button
            key={t}
            className={`btn ${selectedType === t ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: 12, padding: '4px 12px' }}
            onClick={() => setSelectedType(t)}
          >
            {t === 'postmortem' ? <><Flame size={13} /> 事故复盘</> : t === 'change_record' ? <><FileText size={13} /> 变更记录</> : t === 'sop' ? <><BookOpen size={13} /> 标准 SOP</> : '全部文档'}
          </button>
        ))}
      </div>

      {/* Docs Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: 16 }}>
        {filteredDocs.map(doc => (
          <div key={doc.id} className="glass-card" style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.4 }}>{doc.title}</h3>
              <span className="badge" style={{
                background: doc.status === 'reviewed' ? 'rgba(16, 185, 129, 0.2)' : doc.status === 'archived' ? 'rgba(107, 114, 128, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                color: doc.status === 'reviewed' ? 'var(--accent-emerald)' : doc.status === 'archived' ? 'var(--text-muted)' : 'var(--accent-amber)'
              }}>
                {doc.status}
              </span>
            </div>

            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10 }}>
                生成方式: {doc.generated_by === 'agent' ? <><Bot size={12} /> Agent 自动生成</> : <><User size={12} /> 人工编辑</>} | 创建时间: {new Date(doc.created_at).toLocaleDateString()}
            </div>

            <div style={{
              background: '#04060a',
              padding: 10,
              borderRadius: 6,
              fontSize: 12,
              color: '#d1d5db',
              flex: 1,
              maxHeight: 120,
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              marginBottom: 12,
              fontFamily: 'var(--font-mono)'
            }}>
              {doc.content}
            </div>

              {/* Actions Bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTop: '1px solid var(--border-color)' }}>
              <button
                className="btn btn-primary"
                style={{ fontSize: 11, padding: '4px 10px', background: 'linear-gradient(135deg, var(--accent-pink), var(--accent-purple))' }}
                onClick={() => convertDocToSkill(doc.id, doc.title)}
              >
                <BookOpen size={12} /> 存为 SOP 技能
              </button>

              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '4px 8px', fontSize: 11 }}
                  onClick={() => updateDocStatus(doc.id, doc.status === 'draft' ? 'reviewed' : 'archived')}
                >
                  <CheckCircle size={12} /> 推进状态
                </button>
                <button className="btn btn-secondary" style={{ padding: 4 }} onClick={() => setActiveDoc(doc)}>
                  <Eye size={14} />
                </button>
                <button
                  className="btn btn-secondary"
                  style={{
                    padding: 4,
                    color: (confirmDeleteId === doc.id) ? '#fff' : 'var(--accent-rose)',
                    background: (confirmDeleteId === doc.id) ? 'var(--accent-rose)' : undefined,
                    borderColor: (confirmDeleteId === doc.id) ? 'var(--accent-rose)' : undefined,
                  }}
                  onClick={() => {
                    if (confirmDeleteId === doc.id) {
                      setConfirmDeleteId(null);
                      deleteDoc(doc.id);
                    } else {
                      setConfirmDeleteId(doc.id);
                    }
                  }}
                >
                  <Trash2 size={14} /> {(confirmDeleteId === doc.id) ? '确认删除?' : ''}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Doc View Modal */}
      {activeDoc && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: 680 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>{activeDoc.title}</h3>
              <button className="btn btn-secondary" style={{ padding: 4 }} onClick={() => setActiveDoc(null)}><X size={16} /></button>
            </div>

            <div style={{ background: '#030509', padding: 16, borderRadius: 8, fontFamily: 'var(--font-mono)', fontSize: 12, color: '#e5e7eb', maxHeight: 400, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
              {activeDoc.content}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
