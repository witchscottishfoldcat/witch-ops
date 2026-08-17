import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { Box, Play, Square, RefreshCw, Trash2 } from 'lucide-react';

export const ContainersManager: React.FC = () => {
  const { containers, controlContainer, activeServerId, servers } = useApp();
  const currentServer = servers.find(s => s.id === activeServerId);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // 两步确认:3 秒后自动复位
  useEffect(() => {
    if (!confirmDeleteId) return;
    const t = setTimeout(() => setConfirmDeleteId(null), 3000);
    return () => clearTimeout(t);
  }, [confirmDeleteId]);

  return (
    <div>
      <div className="page-title-row">
        <div>
          <h2 className="page-title">
            <Box size={24} style={{ color: 'var(--accent-purple)' }} />
            容器管理 (Docker & Podman Containers)
          </h2>
          <p className="page-subtitle">直接控制目标服务器容器生命周期，所有容器变更指令自动通过统一出口写入审计轨迹。</p>
        </div>
      </div>

      <div style={{ background: 'var(--chip-bg)', border: '1px solid var(--chip-border)', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 20 }}>
        当前节点: <strong>{currentServer?.name || 'Server'}</strong> ({currentServer?.host})
      </div>

      {/* Containers Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
        {containers.map(c => (
          <div key={c.id} className="glass-card" style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 700 }}>{c.name}</h3>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                  {c.image}
                </div>
              </div>
              <span className="badge" style={{
                background: c.state === 'running' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(244, 63, 94, 0.2)',
                color: c.state === 'running' ? 'var(--accent-emerald)' : 'var(--accent-rose)'
              }}>
                {c.state}
              </span>
            </div>

            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 14 }}>
              Runtime: <strong style={{ color: 'var(--text-main)' }}>{c.runtime}</strong> | Status: {c.status}
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
              {c.state === 'running' ? (
                <button
                  className="btn btn-danger"
                  style={{ flex: 1, fontSize: 11, padding: '4px 8px', justifyContent: 'center' }}
                  onClick={() => controlContainer(c.id, 'stop')}
                >
                  <Square size={12} /> 停止 Stop
                </button>
              ) : (
                <button
                  className="btn btn-success"
                  style={{ flex: 1, fontSize: 11, padding: '4px 8px', justifyContent: 'center' }}
                  onClick={() => controlContainer(c.id, 'start')}
                >
                  <Play size={12} /> 启动 Start
                </button>
              )}

              <button
                className="btn btn-secondary"
                style={{ flex: 1, fontSize: 11, padding: '4px 8px', justifyContent: 'center' }}
                onClick={() => controlContainer(c.id, 'restart')}
              >
                <RefreshCw size={12} /> 重启 Restart
              </button>

              <button
                className="btn btn-secondary"
                style={{
                  padding: 6,
                  color: (confirmDeleteId === c.id) ? '#fff' : 'var(--accent-rose)',
                  background: (confirmDeleteId === c.id) ? 'var(--accent-rose)' : undefined,
                  borderColor: (confirmDeleteId === c.id) ? 'var(--accent-rose)' : undefined,
                }}
                onClick={() => {
                  if (confirmDeleteId === c.id) {
                    setConfirmDeleteId(null);
                    controlContainer(c.id, 'remove');
                  } else {
                    setConfirmDeleteId(c.id);
                  }
                }}
                title={confirmDeleteId === c.id ? '再次点击确认删除' : '删除容器'}
              >
                <Trash2 size={12} /> {confirmDeleteId === c.id ? '确认删除?' : ''}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
