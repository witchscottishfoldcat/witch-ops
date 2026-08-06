import React from 'react';
import { useApp } from '../context/AppContext';
import { ShieldAlert, Check, X } from 'lucide-react';

export const HostKeyModal: React.FC = () => {
  const { pendingHostKey, confirmHostKey, cancelHostKey, servers } = useApp();

  if (!pendingHostKey) return null;
  const server = servers.find(s => s.id === pendingHostKey.serverId);

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ background: 'rgba(245, 158, 11, 0.2)', padding: 10, borderRadius: '50%', color: 'var(--accent-amber)' }}>
            <ShieldAlert size={24} />
          </div>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>首次连接 SSH 主机指纹确认</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>服务器 <strong>{server?.name}</strong> ({server?.host}:{server?.port})</p>
          </div>
        </div>

        <p style={{ fontSize: 13, color: 'var(--text-main)', marginBottom: 12, lineHeight: 1.6 }}>
          后端已抓取到该服务器的 Remote Host Key 指纹。为防止中间人攻击 (MITM)，请核对后确认存入凭证数据库：
        </p>

        <div style={{
          background: '#04060a',
          border: '1px solid var(--border-color)',
          borderRadius: 6,
          padding: '12px',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: 'var(--accent-cyan)',
          wordBreak: 'break-all',
          marginBottom: 20
        }}>
          {pendingHostKey.fingerprint}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button className="btn btn-secondary" onClick={cancelHostKey}>
            <X size={14} /> 拒绝并断开
          </button>
          <button className="btn btn-primary" onClick={confirmHostKey}>
            <Check size={14} /> 信任并存入数据库
          </button>
        </div>
      </div>
    </div>
  );
};
