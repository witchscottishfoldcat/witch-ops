import React from 'react';
import { useApp } from '../context/AppContext';
import { Bot, Sparkles, FileText, BookOpen } from 'lucide-react';
import { AgentChatPanel } from './AgentChatPanel';

/** 安全 JSON 解析:渲染期非法 JSON 返回 null,避免白屏 */
function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

/**
 * Agent 智能运维 Copilot(全页)
 *
 * 对话核心已抽取到 AgentChatPanel(终端视图右侧栏复用同一组件)。
 * 本页 = 对话面板 + 常用 Prompt / SOP 技能信息栏。
 */
export const AgentCopilot: React.FC = () => {
  const { skills } = useApp();
  const enabledSkills = skills.filter(s => s.enabled);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 92px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 className="page-title">
            <Bot size={24} style={{ color: 'var(--accent-purple)' }} />
            Witchcat Agent 智能运维 Copilot
          </h2>
          <p className="page-subtitle">
            融合 SOP 技能库,协助排查、分析日志并生成提议指令。
          </p>
        </div>
        <button className="btn btn-secondary" disabled title="开发中" style={{ fontSize: 12, opacity: 0.5 }}>
          <FileText size={14} /> 一键总结并存为复盘文档
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16, flex: 1, minHeight: 0 }}>
        {/* 聊天区(复用组件) */}
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', padding: 16, minHeight: 0 }}>
          <AgentChatPanel />
        </div>

        {/* 右侧信息栏 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 }}>
          <div className="glass-card">
            <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Sparkles size={14} style={{ color: 'var(--accent-cyan)' }} /> 常用 SRE 运维 Prompt
            </h3>
            <PromptList />
          </div>

          <div className="glass-card" style={{ flex: 1, overflowY: 'auto' }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <BookOpen size={14} style={{ color: 'var(--accent-purple)' }} /> 启用的 SOP 技能
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {enabledSkills.map(s => (
                <div key={s.id} style={{ background: 'rgba(0,0,0,0.3)', padding: 8, borderRadius: 6, border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-main)' }}>{s.title}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                    触发关键词: {safeParse<string[]>(s.triggers)?.join(', ') ?? '无'}
                  </div>
                </div>
              ))}
              {enabledSkills.length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>暂无启用的技能</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/** 常用 Prompt 列表:点击通过自定义事件填入对话面板的输入框 */
const PromptList: React.FC = () => {
  const prompts = [
    '检查网关 Nginx 错误日志与 502 根因',
    '扫描生产服务器磁盘占用与大文件',
    '确认 Kubernetes Node Ready 节点状态',
    '查询数据库 PostgreSQL 慢查询日志',
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {prompts.map((p, idx) => (
        <button
          key={idx}
          className="btn btn-secondary"
          style={{ textAlign: 'left', fontSize: 11, padding: 8 }}
          onClick={() => window.dispatchEvent(new CustomEvent('agent:set-input', { detail: p }))}
        >
          {p}
        </button>
      ))}
    </div>
  );
};
