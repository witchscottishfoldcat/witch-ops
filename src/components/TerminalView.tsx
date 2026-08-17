import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { Terminal as TermIcon, Plus, X, Bot } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import * as ipc from '../lib/ipc';
import { AgentChatPanel } from './AgentChatPanel';
import { terminalThemeFor } from '../lib/terminalTheme';

/**
 * 交互式终端视图(重写版)
 *
 * 关键设计(修复旧版问题):
 * - 每个 tab 一个**独立的固定 DOM 容器**,切换 tab 只改 display,不销毁 DOM
 *   (旧版用 innerHTML='' 销毁重建,导致 xterm 状态错乱)
 * - 后端 PTY 打开时用**前端真实计算的 cols/rows**,而不是写死 80x24
 *   (旧版尺寸不一致 → 光标错位、提示符乱码)
 * - xterm.open() 只调用一次
 * - resize 用 ResizeObserver 监听容器,实时同步给后端 PTY
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

/** 根据容器像素尺寸估算 cols/rows(与 xterm 内部一致) */
function estimateSize(el: HTMLElement): { cols: number; rows: number } {
  // 13px 字号等宽字体:单个字符宽约 7.2px,行高约 17px(经验值)
  const charWidth = 7.2;
  const charHeight = 17;
  const cols = Math.max(20, Math.floor(el.clientWidth / charWidth));
  const rows = Math.max(5, Math.floor(el.clientHeight / charHeight));
  return { cols, rows };
}

export const TerminalView: React.FC = () => {
  const {
    terminalTabs, activeTerminalId, setActiveTerminalId, closeTerminal, openTerminal,
    activeServerId, connectedServerIds, theme
  } = useApp();

  // 用 state 强制触发重渲染(当容器需要挂载时)
  const [, forceUpdate] = useState(0);
  const mountPointRef = useRef<HTMLDivElement>(null);

  // 右侧 AI 面板:可折叠,记忆用户选择
  const [showAi, setShowAi] = useState(() => localStorage.getItem('terminal_ai_panel') !== 'off');
  const toggleAi = () => {
    setShowAi(prev => {
      localStorage.setItem('terminal_ai_panel', prev ? 'off' : 'on');
      return !prev;
    });
  };

  const activeTab = terminalTabs.find(t => t.id === activeTerminalId);

  // 为新 tab 创建 xterm 实例(只创建一次)
  const ensureInstance = (tabId: string): TermInstance => {
    let inst = termInstances.get(tabId);
    if (inst) return inst;
    ipc.frontendLog(`ensureInstance 新建 xterm tab=${tabId.slice(0, 16)}`);

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      lineHeight: 1.2,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      allowProposedApi: true,
      theme: terminalThemeFor(theme),
      scrollback: 2000,
      scrollOnUserInput: true,
      convertEol: false, // PTY 自己处理换行,不要前端转
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    // 输出:接管 openTerminal 时已注册的缓冲监听,回放初始输出 + 接管后续
    // (openTerminal 里 beginTerminalBuffer 先注册了监听并缓冲,这里 xterm 就绪后接管)
    ipc.attachTerminalBuffer(tabId, (bytes) => term.write(bytes));

    // 退出事件:即时处理(断开/结束提示)
    ipc.onTerminalExit(tabId, (code) => {
      if (code === -1) {
        // code=-1 表示连接断开(非程序正常退出)
        term.write(`\r\n\x1b[31m━━━ SSH 连接已断开 ━━━\x1b[0m\r\n`);
        term.write(`\x1b[90m请回到"服务器管理"重新连接,或关闭此终端页签后重开。\x1b[0m\r\n`);
      } else {
        term.write(`\r\n\x1b[33m[会话已结束,退出码: ${code}]\x1b[0m\r\n`);
      }
    }).then(un => { inst!.unlistenExit = un; }).catch(() => {});

    // 用户输入 → 后端(base64)
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
  };

  // 挂载/切换终端到容器
  useEffect(() => {
    ipc.frontendLog(`TerminalView effect 触发 tab=${activeTab?.id?.slice(0, 16) ?? 'null'} mount=${!!mountPointRef.current}`);
    if (!activeTab || !mountPointRef.current) return;
    const mountPoint = mountPointRef.current;

    try {
      // 隐藏所有容器
      containerCache.forEach((el) => { el.style.display = 'none'; });

      // 取或建当前 tab 的容器
      let container = containerCache.get(activeTab.id);
      if (!container) {
        container = document.createElement('div');
        container.style.cssText = 'width:100%;height:100%;';
        containerCache.set(activeTab.id, container);
      }

      // 挂到挂载点并显示
      if (container.parentElement !== mountPoint) {
        mountPoint.appendChild(container);
      }
      container.style.display = 'block';

      const inst = ensureInstance(activeTab.id);

      // xterm 只 open 一次
      if (!inst.term.element) {
        inst.term.open(container);
        ipc.frontendLog(`xterm.open 完成 tab=${activeTab.id.slice(0, 16)} 容器=${container.clientWidth}x${container.clientHeight}`);
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

  // 容器尺寸变化(窗口拖动/侧边栏折叠)→ 重新 fit(rAF 节流,避免拖窗口时每帧多次 IPC)
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

  // 主题切换 → 热更新所有存活实例(xterm 实例全局缓存,不重建不丢输出)
  useEffect(() => {
    const t = terminalThemeFor(theme);
    termInstances.forEach((inst) => {
      inst.term.options.theme = t;
      inst.term.refresh(0, inst.term.rows - 1);
    });
  }, [theme]);

  // 注意:不要在组件卸载时 dispose 实例!
  // StrictMode 开发模式会"挂载→卸载→重挂载",若卸载即 dispose,
  // 已回放的 shell 输出会随被销毁的实例丢失 → 黑屏。
  // 实例生命周期由 handleClose(关页签)管理,视图切换时保留。

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

  // 打开新终端:用挂载点的真实尺寸打开 PTY,避免打开瞬间尺寸不一致
  const handleOpenTerminal = async () => {
    if (!activeServerId) return;
    // 用挂载点(或窗口)估算真实 cols/rows
    const el = mountPointRef.current;
    let cols = 80, rows = 24;
    if (el) {
      const size = estimateSize(el);
      cols = size.cols;
      rows = size.rows;
    }
    await openTerminal(activeServerId, cols, rows);
    forceUpdate(n => n + 1);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
                }}
              />
              {connectedServerIds.has(activeTab.serverId) ? '已连接' : '未连接'}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={showAi ? 'btn btn-primary' : 'btn btn-secondary'}
            style={{ fontSize: 12, height: 30 }}
            onClick={toggleAi}
            title={showAi ? '收起右侧 AI 面板' : '展开右侧 AI 面板'}
          >
            <Bot size={14} /> AI 助手
          </button>
          <button
            className="btn btn-secondary"
            style={{ fontSize: 12, height: 30 }}
            onClick={handleOpenTerminal}
          >
            <Plus size={14} /> 打开新终端
          </button>
        </div>
      </div>

      {/* 终端 + 右侧 AI 面板 */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 12 }}>
        <div className="terminal-window" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
        <div className="terminal-header">
          <div className="terminal-tabs">
            {terminalTabs.map(t => (
              <div
                key={t.id}
                className={`terminal-tab ${activeTerminalId === t.id ? 'active' : ''}`}
                onClick={() => setActiveTerminalId(t.id)}
              >
                <span>{t.title}</span>
                <X size={12} style={{ opacity: 0.6 }} onClick={(e) => { e.stopPropagation(); handleClose(t.id); }} />
              </div>
            ))}
            {terminalTabs.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: '4px 8px' }}>无活动终端</div>
            )}
          </div>
        </div>

        {/* xterm 挂载点:固定容器,内部 tab 容器用 display 切换 */}
        <div
          ref={mountPointRef}
          style={{
            flex: 1,
            minHeight: 0,
            background: 'var(--term-bg)',
            overflow: 'hidden',
            position: 'relative',
            borderBottomLeftRadius: 'var(--apple-radius-md)',
            borderBottomRightRadius: 'var(--apple-radius-md)',
          }}
        >
          {!activeTab && (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              选择或新建终端页签
            </div>
          )}
        </div>
        </div>

        {/* 右侧 AI 对话面板(紧凑模式,独立会话) */}
        {showAi && (
          <div className="glass-card" style={{ width: 360, flexShrink: 0, padding: 12, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <AgentChatPanel compact />
          </div>
        )}
      </div>
    </div>
  );
};
