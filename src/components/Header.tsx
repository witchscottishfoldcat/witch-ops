import React from 'react';
import { useApp } from '../context/AppContext';
import { Shield, Lock, Unlock, Server, Bot, Terminal, Search, Palette, Moon, Sun, Heart, Zap } from 'lucide-react';
import { CustomSelect } from './CustomSelect';

export const Header: React.FC = () => {
  const {
    isVaultUnlocked, lockVault, servers, activeServerId, setActiveServerId,
    connectedServerIds, setActiveView, theme, setTheme
  } = useApp();

  const activeServer = servers.find(s => s.id === activeServerId);

  const themeOptions = [
    { value: 'macos-dark', label: 'macOS 黑夜', icon: <Moon size={13} /> },
    { value: 'macos-light', label: 'macOS 白天', icon: <Sun size={13} /> },
    { value: 'bilibili-pink', label: 'Bilibili 粉色', icon: <Heart size={13} style={{ color: 'var(--apple-pink)' }} /> },
    { value: 'cyber-neon', label: '赛博暗黑', icon: <Zap size={13} /> },
    { value: 'monokai-pro', label: 'Monokai 极客', icon: <Palette size={13} /> },
  ];

  const serverOptions = servers.map(s => ({
    value: String(s.id),
    label: `${s.name} (${s.host})`,
    icon: (
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: connectedServerIds.has(s.id) ? 'var(--apple-green)' : 'var(--apple-text-dim)',
          display: 'inline-block',
        }}
      />
    )
  }));

  return (
    <header className="header-bar">
      <div className="header-left">
        {/* macOS Traffic Light Buttons */}
        <div className="mac-traffic-lights">
          <div className="traffic-light traffic-light-close" title="Close" />
          <div className="traffic-light traffic-light-minimize" title="Minimize" />
          <div className="traffic-light traffic-light-maximize" title="Zoom" />
        </div>

        <div className="brand-logo">
          <Shield size={18} style={{ color: 'var(--apple-blue)' }} />
          <span>Witchcat<span style={{ color: 'var(--apple-purple)', marginLeft: 2 }}>Ops</span></span>
          <span style={{ fontSize: 10, background: 'rgba(191, 90, 242, 0.15)', color: 'var(--apple-purple)', padding: '1px 6px', borderRadius: 10, marginLeft: 4, fontWeight: 600 }}>
            v2.4 Pro
          </span>
        </div>

        <div style={{ width: 1, height: 20, background: 'var(--apple-border)', margin: '0 4px' }} />

        {/* Custom Server Selector Dropdown */}
        <CustomSelect
          options={serverOptions}
          value={String(activeServerId || 1)}
          onChange={(val) => setActiveServerId(Number(val))}
          icon={<Server size={14} style={{ color: activeServer ? 'var(--apple-green)' : 'var(--apple-text-muted)' }} />}
        />
      </div>

      <div className="header-right">
        {/* Global Search Bar */}
        <div style={{ position: 'relative', width: 180 }}>
          <Search size={13} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--apple-text-dim)' }} />
          <input
            className="input-field"
            placeholder="搜索节点, SOP..."
            style={{ paddingLeft: 28, fontSize: 12, height: 30 }}
          />
        </div>

        {/* Custom Multi-Theme Palette Selector Popover */}
        <CustomSelect
          options={themeOptions}
          value={theme}
          onChange={(val) => setTheme(val)}
          icon={<Palette size={14} style={{ color: 'var(--apple-blue)' }} />}
        />

        {/* Agent Quick Entry */}
        <button
          className="btn btn-secondary"
          onClick={() => setActiveView('agent')}
          style={{ height: 30, fontSize: 12 }}
        >
          <Bot size={14} style={{ color: 'var(--apple-purple)' }} />
          <span>Agent</span>
        </button>

        {/* Terminal Quick Entry */}
        <button
          className="btn btn-secondary"
          onClick={() => setActiveView('terminal')}
          style={{ height: 30, fontSize: 12 }}
        >
          <Terminal size={14} style={{ color: 'var(--apple-cyan)' }} />
          <span>PTY Stream</span>
        </button>

        {/* Vault Unlock Badge Button */}
        <button
          className={`btn ${isVaultUnlocked ? 'btn-success' : 'btn-danger'}`}
          onClick={() => isVaultUnlocked ? lockVault() : setActiveView('settings')}
          style={{ height: 30, fontSize: 12 }}
          title={isVaultUnlocked ? 'Vault 已解锁 (AES-GCM-256)' : 'Vault 已锁定，点击前往解锁'}
        >
          {isVaultUnlocked ? <Unlock size={13} /> : <Lock size={13} />}
          <span>{isVaultUnlocked ? 'Vault 解锁' : 'Vault 锁定'}</span>
        </button>
      </div>
    </header>
  );
};
