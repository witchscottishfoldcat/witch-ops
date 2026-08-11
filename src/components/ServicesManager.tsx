import React from 'react';
import { useApp } from '../context/AppContext';
import { Cpu, Play, Square, RefreshCw } from 'lucide-react';

export const ServicesManager: React.FC = () => {
  const { services, controlService, activeServerId, servers } = useApp();
  const currentServer = servers.find(s => s.id === activeServerId);

  return (
    <div>
      <div className="page-title-row">
        <div>
          <h2 className="page-title">
            <Cpu size={24} style={{ color: 'var(--accent-cyan)' }} />
            Systemd 服务管理 (Linux Systemd Daemon Services)
          </h2>
          <p className="page-subtitle">监视 Linux 节点守护进程激活状态（Active / Inactive），提供开机自启与重载控制。</p>
        </div>
      </div>

      <div style={{ background: 'rgba(6, 182, 212, 0.1)', border: '1px solid rgba(6, 182, 212, 0.2)', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 20 }}>
        目标服务器: <strong>{currentServer?.name || 'Server'}</strong> ({currentServer?.host})
      </div>

      {/* Services Table */}
      <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>服务 Unit 名称</th>
              <th>描述 Description</th>
              <th>加载状态</th>
              <th>激活状态 Active</th>
              <th>Sub State</th>
              <th>控制操作</th>
            </tr>
          </thead>
          <tbody>
            {services.map((svc, idx) => (
              <tr key={idx}>
                <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#fff' }}>{svc.name}</td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{svc.description}</td>
                <td style={{ fontSize: 12, color: 'var(--text-dim)' }}>{svc.load_state}</td>
                <td>
                  <span className="badge" style={{
                    background: svc.active_state === 'active' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(244, 63, 94, 0.2)',
                    color: svc.active_state === 'active' ? 'var(--accent-emerald)' : 'var(--accent-rose)'
                  }}>
                    {svc.active_state}
                  </span>
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{svc.sub_state}</td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {svc.active_state === 'active' ? (
                      <button className="btn btn-danger" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => controlService(svc.name, 'stop')}>
                        <Square size={10} /> 停止
                      </button>
                    ) : (
                      <button className="btn btn-success" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => controlService(svc.name, 'start')}>
                        <Play size={10} /> 启动
                      </button>
                    )}
                    <button className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => controlService(svc.name, 'restart')}>
                      <RefreshCw size={10} /> 重启
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
