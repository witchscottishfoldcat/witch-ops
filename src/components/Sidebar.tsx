import React from 'react';
import { useApp } from '../context/AppContext';
import {
  Server, Terminal, Bot, ShieldCheck, BookOpen, Zap,
  FileCode, FolderTree, Activity, Box, Cpu, Settings,
  PanelLeftClose, PanelLeftOpen
} from 'lucide-react';

export const Sidebar: React.FC = () => {
  const {
    activeView, setActiveView, servers, auditLogs, skills,
    quickActions, docs, containers, services, terminalTabs,
    isSidebarCollapsed, toggleSidebar
  } = useApp();

  const navGroups = [
    {
      title: '基础运维',
      items: [
        { id: 'servers', label: '服务器管理', icon: Server, badge: servers.length },
        { id: 'terminal', label: 'PTY 终端流', icon: Terminal, badge: terminalTabs.length },
        { id: 'sftp', label: 'SFTP 文件', icon: FolderTree },
      ]
    },
    {
      title: 'AI 智能与 SOP',
      items: [
        { id: 'agent', label: 'Agent Copilot', icon: Bot, badge: 'AI' },
        { id: 'skills', label: 'SOP 技能库', icon: BookOpen, badge: skills.length },
        { id: 'quick_actions', label: '快捷指令', icon: Zap, badge: quickActions.length },
        { id: 'docs', label: '文档与飞轮', icon: FileCode, badge: docs.length },
      ]
    },
    {
      title: '监控与容器',
      items: [
        { id: 'metrics', label: '监控仪表盘', icon: Activity },
        { id: 'containers', label: '容器管理', icon: Box, badge: containers.length },
        { id: 'services', label: 'Systemd 服务', icon: Cpu, badge: services.length },
      ]
    },
    {
      title: '系统与安全',
      items: [
        { id: 'audit', label: '审计日志', icon: ShieldCheck, badge: auditLogs.length },
        { id: 'settings', label: '设置与 Vault', icon: Settings },
      ]
    }
  ];

  return (
    <aside className={`sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
      {/* Top Collapse Toggle Button Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: isSidebarCollapsed ? 'center' : 'space-between',
        padding: '6px 8px 10px 8px',
        borderBottom: '1px solid var(--apple-border)',
        marginBottom: 8
      }}>
        {!isSidebarCollapsed && (
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--apple-text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            主导航
          </span>
        )}
        <button
          className="btn btn-secondary"
          onClick={toggleSidebar}
          style={{ padding: 6, borderRadius: 6, height: 28, width: 28, justifyContent: 'center' }}
          title={isSidebarCollapsed ? '展开侧边栏 (⌘B)' : '收起侧边栏只留图标 (⌘B)'}
        >
          {isSidebarCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
      </div>

      {/* Nav Groups */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', flex: 1 }}>
        {navGroups.map((group, gIdx) => (
          <div key={gIdx} className="sidebar-group">
            {!isSidebarCollapsed && (
              <div className="sidebar-group-label">
                {group.title}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {group.items.map(item => {
                const Icon = item.icon;
                const isActive = activeView === item.id;

                return (
                  <div
                    key={item.id}
                    className={`sidebar-nav-item ${isActive ? 'active' : ''}`}
                    onClick={() => setActiveView(item.id)}
                    title={isSidebarCollapsed ? `${item.label} (${item.badge ?? ''})` : undefined}
                    style={{
                      justifyContent: isSidebarCollapsed ? 'center' : 'space-between',
                      padding: isSidebarCollapsed ? '10px 0' : '7px 12px'
                    }}
                  >
                    <div className="nav-left-part" style={{ justifyContent: isSidebarCollapsed ? 'center' : 'flex-start', width: isSidebarCollapsed ? '100%' : 'auto' }}>
                      <Icon size={16} style={{ color: isActive ? '#fff' : 'inherit' }} />
                      {!isSidebarCollapsed && <span>{item.label}</span>}
                    </div>

                    {!isSidebarCollapsed && item.badge !== undefined && (
                      <span className="nav-badge">{item.badge}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
};
