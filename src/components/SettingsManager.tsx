import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { ProviderInput } from '../types/backend';
import { Settings, Plus, Eye, EyeOff, Trash2, Cpu, Lock } from 'lucide-react';
import { VaultModal } from './VaultModal';

/** 安全 JSON 解析:渲染期非法 JSON 返回 null,避免白屏 */
function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

export const SettingsManager: React.FC = () => {
  const { providers, addProvider, deleteProvider, isVaultUnlocked, isVaultInitialized } = useApp();
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // 两步确认:3 秒后自动复位
  useEffect(() => {
    if (!confirmDeleteId) return;
    const t = setTimeout(() => setConfirmDeleteId(null), 3000);
    return () => clearTimeout(t);
  }, [confirmDeleteId]);

  const [formData, setFormData] = useState<ProviderInput>({
    name: '',
    base_url: '',
    api_key: '',
    default_model: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner']
  });

  const toggleShowKey = (id: string) => {
    setShowKey(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.base_url || !formData.api_key) return;
    setSaving(true);
    try {
      await addProvider(formData);
      setShowModal(false);
      setFormData({ name: '', base_url: '', api_key: '', default_model: 'deepseek-chat', models: ['deepseek-chat'] });
    } catch {
      // 保存失败时保留弹窗和表单数据,错误已由 context toast 提示
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="page-title-row">
        <div>
          <h2 className="page-title">
            <Settings size={24} style={{ color: 'var(--accent-purple)' }} />
            设置与 LLM Provider 管理 (Settings & Vault)
          </h2>
          <p className="page-subtitle">配置加密 Vault 主密码，关联 DeepSeek、Claude、OpenAI 等后端大模型 API 服务商。</p>
        </div>
      </div>

      {/* Vault Security Status Banner */}
      <VaultModal />

      {/* LLM Providers Section */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, marginTop: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Cpu size={20} style={{ color: 'var(--accent-cyan)' }} /> LLM Provider 服务商接入 (`list_providers`)
        </h3>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> 添加 LLM Provider
        </button>
      </div>

      {/* Providers Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
        {providers.map(p => {
          const models: string[] = safeParse<string[]>(p.models) ?? [];
          const isKeyVisible = showKey[p.id];
          const confirming = confirmDeleteId === p.id;

          return (
            <div key={p.id} className="glass-card" style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <h4 style={{ fontSize: 15, fontWeight: 700 }}>{p.name}</h4>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                    {p.base_url}
                  </div>
                </div>
                <button
                  className="btn btn-secondary"
                  style={{
                    padding: 6,
                    color: confirming ? '#fff' : 'var(--accent-rose)',
                    background: confirming ? 'var(--accent-rose)' : undefined,
                    borderColor: confirming ? 'var(--accent-rose)' : undefined,
                  }}
                  onClick={() => {
                    if (confirming) {
                      setConfirmDeleteId(null);
                      deleteProvider(p.id);
                    } else {
                      setConfirmDeleteId(p.id);
                    }
                  }}
                  title={confirming ? '再次点击确认删除' : '删除 Provider'}
                >
                  <Trash2 size={14} /> {confirming ? '确认删除?' : ''}
                </button>
              </div>

              {/* API Key Box */}
              <div style={{ background: '#04060a', padding: 8, borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, border: '1px solid var(--border-color)' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent-cyan)' }}>
                  {!isVaultUnlocked ? '*** (Vault 已锁定)' : isKeyVisible ? p.api_key_enc : '••••••••••••••••••••'}
                </span>
                {isVaultUnlocked && (
                  <button style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }} onClick={() => toggleShowKey(p.id)}>
                    {isKeyVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                )}
              </div>

              {/* Default Model */}
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                默认模型: <strong style={{ color: '#fff' }}>{p.default_model || '未设置'}</strong>
              </div>

              {/* Supported Models */}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 'auto' }}>
                {models.map(m => (
                  <span key={m} style={{ background: 'rgba(139, 92, 246, 0.15)', color: 'var(--accent-purple)', fontSize: 10, padding: '2px 6px', borderRadius: 4 }}>
                    {m}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Provider Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>添加 LLM Provider 服务商</h3>
            <form onSubmit={handleAddSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Vault 已启用但锁定:保存 API Key 会失败,强提示 */}
              {isVaultInitialized && !isVaultUnlocked && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 14px',
                    borderRadius: 8,
                    background: 'rgba(255, 159, 10, 0.1)',
                    border: '1px solid rgba(255, 159, 10, 0.2)',
                    color: 'var(--apple-yellow)',
                    fontSize: 12,
                  }}
                >
                  <Lock size={14} />
                  <span>请先解锁 Vault 才能保存 API key</span>
                </div>
              )}
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>服务商名称</label>
                <input
                  className="input-field"
                  placeholder="e.g. DeepSeek Official"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Base URL API 地址</label>
                <input
                  className="input-field"
                  placeholder="https://api.deepseek.com/v1"
                  value={formData.base_url}
                  onChange={e => setFormData({ ...formData, base_url: e.target.value })}
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>API Key (明文输入，将由 Vault 加密保存)</label>
                <input
                  type="password"
                  className="input-field"
                  placeholder="sk-..."
                  value={formData.api_key}
                  onChange={e => setFormData({ ...formData, api_key: e.target.value })}
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>默认模型</label>
                <input
                  className="input-field"
                  value={formData.default_model || ''}
                  onChange={e => setFormData({ ...formData, default_model: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)} disabled={saving}>取消</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '保存中…' : '保存 Provider'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
