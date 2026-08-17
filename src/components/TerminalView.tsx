import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import {
  Terminal as TermIcon, Plus, X, Bot, Trash2, ZoomIn, ZoomOut
} from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import * as ipc from '../lib/ipc';
import { AgentChatPanel } from './AgentChatPanel';
import { terminalThemeFor } from '../lib/terminalTheme';
import { beautifyTerminalOutput, renderLivePromptLine } from '../lib/terminalBeautifier';

/**
 * 交互式终端视图 (纯前端 Canvas 渲染引擎)
 *
 * 设计原则:
 * - 纯前端 Canvas / WebGL 渲染,零向远端注入任何命令/脚本
 * - 默认内置 Catppuccin Mocha / Tokyo Night 高对比度 ANSI 16 色与等宽排版
 * - 每个 tab 独立 DOM 容器与全局 xterm 实例,切换 tab 仅切换 display
 * - 保持远端 SSH PTY 通道 100% 纯净与稳定
 */

interface TermInstance {
  term: Terminal;
  fitAddon: FitAddon;
  unlistenOutput?: () => void;
  unlistenExit?: () => void;
}

// 全局缓存:xterm 实例 & 容器(避免重建)
const termInstances = new Map<string, TermInstance>();
const containerCache = new Map<string, HTMLDivElement>();

/** 根据容器像素尺寸估算 cols/rows */
function estimateSize(el: HTMLElement, fontSize = 13.5): { cols: number; rows: number } {
  const charWidth = fontSize * 0.58;
  const charHeight = fontSize * 1.35;
  const cols = Math.max(20, Math.floor(el.clientWidth / charWidth));
  const rows = Math.max(5, Math.floor(el.clientHeight / charHeight));
  return { cols, rows };
}

export const TerminalView: React.FC = () => {
  const {
    terminalTabs, activeTerminalId, setActiveTerminalId, closeTerminal, openTerminal,
    activeServerId, connectedServerIds, theme
  } = useApp();

  // 终端配色跟随当前主题 (或自动适配最高品质的开源标准调色板)
  const effectiveTheme = theme || 'macos-dark';

  // 字号大小调节(持久化存储)
  const [fontSize, setFontSize] = useState<number>(() => {
    const saved = localStorage.getItem('terminal_font_size');
    return saved ? Math.max(11, Math.min(22, Number(saved))) : 13.5;
  });

  // 用 state 强制触发重渲染
  const [, forceUpdate] = useState(0);
  const mountPointRef = useRef<HTMLDivElement>(null);

  // 右侧 AI 面板
  const [showAi, setShowAi] = useState(() => localStorage.getItem('terminal_ai_panel') !== 'off');
  const toggleAi = () => {
    setShowAi(prev => {
      localStorage.setItem('terminal_ai_panel', prev ? 'off' : 'on');
      return !prev;
    });
  };

  const activeTab = terminalTabs.find(t => t.id === activeTerminalId);

  // 获取或创建 xterm 实例 (纯净 PTY,零指令注入)
  const getOrCreateInstance = useCallback((tabId: string): TermInstance => {
    let inst = termInstances.get(tabId);
    if (inst) return inst;
    ipc.frontendLog(`getOrCreateInstance 新建 xterm tab=${tabId.slice(0, 16)}`);

    const currentThemePalette = terminalThemeFor(effectiveTheme);

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      cursorInactiveStyle: 'outline',
      fontSize,
      lineHeight: 1.35,
      letterSpacing: 0.2,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", "SFMono-Regular", Menlo, Monaco, Consolas, monospace',
      fontWeight: '400',
      fontWeightBold: '600',
      allowProposedApi: true,
      theme: currentThemePalette,
      scrollback: 5000,
      scrollOnUserInput: true,
      smoothScrollDuration: 120,
      convertEol: false,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    // 输出:接管 openTerminal 缓冲监听并纯前端美化渲染与打字实时校验
    ipc.attachTerminalBuffer(tabId, (bytes) => {
      const enhanced = beautifyTerminalOutput(bytes);
      term.write(enhanced, () => {
        // 当收到打字回显或退格时,实时重绘当前光标行(保证多屏滚动历史下 100% 永久稳定触发)
        if (bytes.length <= 64) {
          try {
            const buffer = term.buffer.active;
            const lineIndex = buffer.baseY + buffer.cursorY;
            const line = buffer.getLine(lineIndex)?.translateToString(true) || '';
            const redrawn = renderLivePromptLine(line);
            if (redrawn) {
              term.write(redrawn);
            }
          } catch {}
        }
      });
    });

    // 退出事件处理
    ipc.onTerminalExit(tabId, (code) => {
      if (code === -1) {
        term.write(`\r\n\x1b[38;2;255;107;129m━━━ SSH 连接已断开 ━━━\x1b[0m\r\n`);
        term.write(`\x1b[38;2;140;149;159m请回到"服务器管理"重新连接,或关闭此终端页签后重开。\x1b[0m\r\n`);
      } else {
        term.write(`\r\n\x1b[38;2;227;179;65m[会话已结束,退出码: ${code}]\x1b[0m\r\n`);
      }
    }).then(un => { inst!.unlistenExit = un; }).catch(() => {});

    // 用户原生键盘输入 → 后端 PTY (绝对不附带任何额外注入)
    term.onData((data) => {
      const b64 = btoa(unescape(encodeURIComponent(data)));
      ipc.terminalInput(tabId, b64).catch(e => console.error('发送输入失败', e));
    });

    // xterm 尺寸变化 → 后端 PTY
    term.onResize(({ cols, rows }) => {
      ipc.terminalResize(tabId, cols, rows).catch(() => {});
    });

    inst = { term, fitAddon };
    termInstances.set(tabId, inst);
    return inst;
  }, [fontSize, effectiveTheme]);

  // 挂载/切换终端到容器 (仅在 activeTab.id 变化时触发)
  useEffect(() => {
    if (!activeTab || !mountPointRef.current) return;
    const mountPoint = mountPointRef.current;
    const currentThemePalette = terminalThemeFor(effectiveTheme);

    try {
      // 隐藏所有容器
      containerCache.forEach((el) => { el.style.display = 'none'; });

      // 取或建当前 tab 的容器
      let container = containerCache.get(activeTab.id);
      if (!container) {
        container = document.createElement('div');
        container.style.cssText = `width:100%;height:100%;background:${currentThemePalette.background || 'var(--term-bg)'};`;
        containerCache.set(activeTab.id, container);
      } else {
        container.style.background = currentThemePalette.background || 'var(--term-bg)';
      }

      // 挂到挂载点并显示
      if (container.parentElement !== mountPoint) {
        mountPoint.appendChild(container);
      }
      container.style.display = 'block';

      const inst = getOrCreateInstance(activeTab.id);

      // xterm 只 open 一次
      if (!inst.term.element) {
        inst.term.open(container);
      } else if (inst.term.element.parentElement !== container) {
        container.appendChild(inst.term.element);
      }

      // fit + 同步尺寸给后端
      requestAnimationFrame(() => {
        try {
          inst.fitAddon.fit();
          const { cols, rows } = inst.term;
          ipc.terminalResize(activeTab.id, cols, rows).catch(() => {});
        } catch (e) {
          console.error('终端 fit 失败', e);
        }
      });
    } catch (e) {
      ipc.frontendLog(`TerminalView effect 异常: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [activeTab?.id]);

  // 容器尺寸变化监听
  useEffect(() => {
    if (!mountPointRef.current || !activeTab) return;
    const inst = termInstances.get(activeTab.id);
    if (!inst) return;
    let rafId: number | null = null;

    const observer = new ResizeObserver(() => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        try {
          inst.fitAddon.fit();
          const { cols, rows } = inst.term;
          ipc.terminalResize(activeTab.id, cols, rows).catch(() => {});
        } catch {}
        rafId = null;
      });
    });
    observer.observe(mountPointRef.current);
    return () => {
      observer.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [activeTab?.id]);

  // 主题切换 → 热更新所有存活实例与容器背景
  useEffect(() => {
    const t = terminalThemeFor(effectiveTheme);
    termInstances.forEach((inst) => {
      inst.term.options.theme = t;
      inst.term.refresh(0, inst.term.rows - 1);
    });
    containerCache.forEach((el) => {
      el.style.background = t.background || 'var(--term-bg)';
    });
    if (mountPointRef.current) {
      mountPointRef.current.style.background = t.background || 'var(--term-bg)';
    }
  }, [effectiveTheme]);

  // 字号切换
  const handleFontSizeChange = (delta: number) => {
    const nextSize = Math.max(11, Math.min(22, fontSize + delta));
    setFontSize(nextSize);
    localStorage.setItem('terminal_font_size', String(nextSize));

    termInstances.forEach((inst, tabId) => {
      inst.term.options.fontSize = nextSize;
      requestAnimationFrame(() => {
        try {
          inst.fitAddon.fit();
          const { cols, rows } = inst.term;
          ipc.terminalResize(tabId, cols, rows).catch(() => {});
        } catch {}
      });
    });
  };

  // 清屏操作
  const handleClear = () => {
    if (!activeTab) return;
    const inst = termInstances.get(activeTab.id);
    if (inst) {
      inst.term.clear();
      inst.term.focus();
    }
  };

  const handleClose = async (tabId: string) => {
    const inst = termInstances.get(tabId);
    inst?.unlistenOutput?.();
    inst?.unlistenExit?.();
    inst?.term.dispose();
    termInstances.delete(tabId);
    const container = containerCache.get(tabId);
    container?.remove();
    containerCache.delete(tabId);
    await closeTerminal(tabId);
  };

  // 打开新终端
  const handleOpenTerminal = async () => {
    if (!activeServerId) return;
    const el = mountPointRef.current;
    let cols = 80, rows = 24;
    if (el) {
      const size = estimateSize(el, fontSize);
      cols = size.cols;
      rows = size.rows;
    }
    await openTerminal(activeServerId, cols, rows);
    forceUpdate(n => n + 1);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 顶部标题栏 */}
      <div className="page-title-row">
        <div className="page-title">
          <TermIcon size={20} style={{ color: 'var(--accent-cyan)' }} />
          PTY 交互式终端
          {activeTab && (
            <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-dim)', display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
              <span
                style={{
                  width: 8, height: 8, borderRadius: '50%', display: 'inline-block',
                  background: connectedServerIds.has(activeTab.serverId) ? 'var(--apple-green)' : 'var(--apple-red)',
                  boxShadow: connectedServerIds.has(activeTab.serverId) ? '0 0 6px rgba(52, 199, 89, 0.4)' : 'none',
                }}
              />
              {connectedServerIds.has(activeTab.serverId) ? '已连接' : '未连接'}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className={showAi ? 'btn btn-primary' : 'btn btn-secondary'}
            style={{ fontSize: 12, height: 32 }}
            onClick={toggleAi}
            title={showAi ? '收起右侧 AI 面板' : '展开右侧 AI 面板'}
          >
            <Bot size={14} /> AI 助手
          </button>
          <button
            className="btn btn-secondary"
            style={{ fontSize: 12, height: 32 }}
            onClick={handleOpenTerminal}
          >
            <Plus size={14} /> 打开新终端
          </button>
        </div>
      </div>

      {/* 终端 + 右侧 AI 面板 */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 12 }}>
        {/* 左侧终端卡片 */}
        <div className="glass-card terminal-window" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, padding: 0, overflow: 'hidden' }}>
          <div className="terminal-header">
            {/* 标签页列表 */}
            <div className="terminal-tabs">
              {terminalTabs.map(t => (
                <div
                  key={t.id}
                  className={`terminal-tab ${activeTerminalId === t.id ? 'active' : ''}`}
                  onClick={() => setActiveTerminalId(t.id)}
                  title={t.title}
                >
                  <TermIcon size={13} style={{ opacity: activeTerminalId === t.id ? 1 : 0.6, flexShrink: 0 }} />
                  <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.title}
                  </span>
                  <span
                    className="tab-close-icon"
                    onClick={(e) => { e.stopPropagation(); handleClose(t.id); }}
                    title="关闭此标签"
                  >
                    <X size={11} />
                  </span>
                </div>
              ))}

              {terminalTabs.length > 0 && (
                <button
                  className="terminal-tool-btn"
                  onClick={handleOpenTerminal}
                  title="新建终端页签"
                  style={{ padding: '4px 6px' }}
                >
                  <Plus size={13} />
                </button>
              )}

              {terminalTabs.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: '4px 8px' }}>无活动终端</div>
              )}
            </div>

            {/* 终端右侧精炼工具栏 */}
            {activeTab && (
              <div className="terminal-toolbar">
                {/* 字号缩放 */}
                <button
                  className="terminal-tool-btn"
                  onClick={() => handleFontSizeChange(-1)}
                  title="缩小字体 (A-)"
                  disabled={fontSize <= 11}
                >
                  <ZoomOut size={12} />
                </button>
                <span style={{ fontSize: 10, color: 'var(--text-dim)', minWidth: 26, textAlign: 'center', userSelect: 'none' }}>
                  {fontSize}px
                </span>
                <button
                  className="terminal-tool-btn"
                  onClick={() => handleFontSizeChange(1)}
                  title="放大字体 (A+)"
                  disabled={fontSize >= 22}
                >
                  <ZoomIn size={12} />
                </button>

                <div style={{ width: 1, height: 14, background: 'var(--apple-border)', margin: '0 2px' }} />

                <button
                  className="terminal-tool-btn"
                  onClick={handleClear}
                  title="清屏 (Clear)"
                >
                  <Trash2 size={12} /> 清屏
                </button>
              </div>
            )}
          </div>

          {/* xterm 挂载点 */}
          <div
            ref={mountPointRef}
            className="terminal-mount-box"
          >
            {!activeTab && (
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--text-muted)' }}>
                <TermIcon size={48} style={{ opacity: 0.25 }} />
                <div style={{ fontSize: 13 }}>选择或新建终端页签以开启 PTY 会话</div>
                {activeServerId && (
                  <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={handleOpenTerminal}>
                    <Plus size={13} /> 为当前服务器打开终端
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 右侧 AI 对话面板 */}
        {showAi && (
          <div className="glass-card" style={{ width: 360, flexShrink: 0, padding: 12, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <AgentChatPanel compact />
          </div>
        )}
      </div>
    </div>
  );
};
