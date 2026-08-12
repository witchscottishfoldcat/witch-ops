import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { HostKeyModal } from './components/HostKeyModal';
import { ServerManager } from './components/ServerManager';
import { TerminalView } from './components/TerminalView';
import { AgentCopilot } from './components/AgentCopilot';
import { AgentMemory } from './components/AgentMemory';
import { AuditLogs } from './components/AuditLogs';
import { SkillsManager } from './components/SkillsManager';
import { QuickActions } from './components/QuickActions';
import { DocsHub } from './components/DocsHub';
import { SftpBrowser } from './components/SftpBrowser';
import { MetricsDashboard } from './components/MetricsDashboard';
import { ContainersManager } from './components/ContainersManager';
import { ServicesManager } from './components/ServicesManager';
import { SettingsManager } from './components/SettingsManager';
import { ErrorToast } from './components/ErrorToast';
import { ErrorBoundary } from './components/ErrorBoundary';
import './App.css';

const MainContent: React.FC = () => {
  const { activeView } = useApp();

  return (
    <main className="content-area">
      <ErrorToast />
      <ErrorBoundary>
        {/* Agent + Terminal 视图常驻不卸载(CSS 隐藏/显示):保证切走再回来对话/终端状态不丢失 */}
        <div style={{ display: activeView === 'agent' ? 'block' : 'none', height: '100%' }}>
          <AgentCopilot />
        </div>
        <div style={{ display: activeView === 'terminal' ? 'block' : 'none', height: '100%' }}>
          <TerminalView />
        </div>
        {activeView === 'servers' && <ServerManager />}
        {activeView === 'audit' && <AuditLogs />}
        {activeView === 'agent_memory' && <AgentMemory />}
        {activeView === 'skills' && <SkillsManager />}
        {activeView === 'quick_actions' && <QuickActions />}
        {activeView === 'docs' && <DocsHub />}
        {activeView === 'sftp' && <SftpBrowser />}
        {activeView === 'metrics' && <MetricsDashboard />}
        {activeView === 'containers' && <ContainersManager />}
        {activeView === 'services' && <ServicesManager />}
        {activeView === 'settings' && <SettingsManager />}
      </ErrorBoundary>
    </main>
  );
};

export default function App() {
  return (
    <AppProvider>
      <div className="app-container">
        <Header />
        <div className="app-main">
          <Sidebar />
          <MainContent />
        </div>
        <HostKeyModal />
      </div>
    </AppProvider>
  );
}
