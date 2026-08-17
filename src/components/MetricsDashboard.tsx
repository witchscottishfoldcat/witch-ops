import React from 'react';
import { useApp } from '../context/AppContext';
import { Activity, Cpu, HardDrive, Clock, BarChart2 } from 'lucide-react';

export const MetricsDashboard: React.FC = () => {
  const { metrics, servers, activeServerId, connectedServerIds } = useApp();
  const currentServer = servers.find(s => s.id === activeServerId);

  if (!metrics) {
    const isConnected = activeServerId ? connectedServerIds.has(activeServerId) : false;
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-dim)' }}>
        {!activeServerId ? '请先选择一个服务器' : isConnected ? '正在加载监控数据...' : '服务器未连接,请先连接后再查看监控'}
      </div>
    );
  }

  const memPercent = metrics.mem_total > 0 ? Math.round((metrics.mem_used / metrics.mem_total) * 100) : 0;
  const swapPercent = metrics.swap_total > 0 ? Math.round((metrics.swap_used / metrics.swap_total) * 100) : 0;
  const cpuPercent = Math.min(100, Math.max(0, metrics.cpu_usage));
  const uptimeDays = Math.floor(metrics.uptime_seconds / 86400);

  return (
    <div>
      <div className="page-title-row">
        <div>
          <h2 className="page-title">
            <Activity size={24} style={{ color: 'var(--accent-emerald)' }} />
            监控仪表盘 (Real-time System Metrics)
          </h2>
          <p className="page-subtitle">读取底层 `/proc` 与 `free`/`df` 数据，实时轮询解析节点系统使用率与负载曲线。</p>
        </div>
      </div>

      <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 20 }}>
        当前监控节点: <strong>{currentServer?.name || 'Server'}</strong> ({currentServer?.host}) | 运行时间: <strong>{uptimeDays} 天</strong>
      </div>

      {/* Top 4 Metric Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16, marginBottom: 20 }}>
        {/* CPU Usage */}
        <div className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Cpu size={16} style={{ color: 'var(--accent-cyan)' }} /> CPU 使用率
            </span>
            <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent-cyan)' }}>{cpuPercent.toFixed(1)}%</span>
          </div>
          <div style={{ height: 8, background: 'var(--panel-inset-bg)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${cpuPercent}%`, height: '100%', background: 'linear-gradient(90deg, var(--accent-cyan), var(--accent-purple))' }} />
          </div>
        </div>

        {/* Memory Usage */}
        <div className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <BarChart2 size={16} style={{ color: 'var(--accent-purple)' }} /> 内存分布
            </span>
            <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent-purple)' }}>{memPercent}%</span>
          </div>
          <div style={{ height: 8, background: 'var(--panel-inset-bg)', borderRadius: 4, overflow: 'hidden', marginBottom: 6 }}>
            <div style={{ width: `${memPercent}%`, height: '100%', background: 'var(--accent-purple)' }} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', display: 'flex', justifyContent: 'space-between' }}>
            <span>已用: {(metrics.mem_used / 1024 / 1024).toFixed(1)} GB</span>
            <span>总量: {(metrics.mem_total / 1024 / 1024).toFixed(1)} GB</span>
          </div>
        </div>

        {/* System Load */}
        <div className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Activity size={16} style={{ color: 'var(--accent-amber)' }} /> Load Average
            </span>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent-amber)' }}>{metrics.load_1}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-around' }}>
            <span>1m: {metrics.load_1}</span>
            <span>5m: {metrics.load_5}</span>
            <span>15m: {metrics.load_15}</span>
          </div>
        </div>

        {/* Swap Usage */}
        <div className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Clock size={16} style={{ color: 'var(--accent-pink)' }} /> Swap 交换区
            </span>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-main)' }}>
              {swapPercent}%
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            已用: {(metrics.swap_used / 1024).toFixed(0)} MB / {(metrics.swap_total / 1024).toFixed(0)} MB
          </div>
        </div>
      </div>

      {/* Disks List */}
      <div className="glass-card">
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <HardDrive size={18} style={{ color: 'var(--accent-cyan)' }} /> 磁盘挂载点空间占用 (Disks & Volumes)
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {metrics.disks.map((d, idx) => {
            const pct = Math.min(100, Math.max(0, d.usage_percent));
            return (
            <div key={idx} style={{ background: 'var(--panel-inset-bg)', padding: 12, borderRadius: 8, border: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div>
                  <strong style={{ fontSize: 13 }}>{d.mount}</strong>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 8, fontFamily: 'var(--font-mono)' }}>({d.filesystem})</span>
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: pct > 80 ? 'var(--accent-rose)' : 'var(--accent-emerald)' }}>
                  {pct.toFixed(1)}%
                </span>
              </div>

              <div style={{ height: 6, background: 'var(--panel-inset-bg)', borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
                <div style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: pct > 80 ? 'var(--accent-rose)' : 'var(--accent-emerald)'
                }} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
                <span>已用: {(d.used / 1024 / 1024).toFixed(1)} GB</span>
                <span>可用: {(d.avail / 1024 / 1024).toFixed(1)} GB</span>
                <span>总量: {(d.total / 1024 / 1024).toFixed(1)} GB</span>
              </div>
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
