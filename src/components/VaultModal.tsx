import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Lock, Unlock, Key, ShieldCheck, ShieldAlert } from 'lucide-react';

/**
 * Vault 凭证库卡片
 *
 * 三种状态:
 * 1. 未初始化(首次使用)→ 设置主密码(创建 Vault)
 * 2. 已初始化但未解锁 → 输入主密码解锁
 * 3. 已解锁 → 显示状态 + 锁定按钮
 */
export const VaultModal: React.FC = () => {
  const { isVaultInitialized, isVaultUnlocked, unlockVault, lockVault, setupVault } = useApp();
  const [pass, setPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [busy, setBusy] = useState(false);

  // ============ 已解锁:显示状态 ============
  if (isVaultUnlocked) {
    return (
      <div className="glass-card" style={{ marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderLeft: '4px solid var(--accent-emerald)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ background: 'rgba(16, 185, 129, 0.2)', padding: 8, borderRadius: 8, color: 'var(--accent-emerald)' }}>
            <ShieldCheck size={20} />
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Vault 凭证库已安全解锁</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>内存 Data Key 已加载,所有的 SSH 密钥、密码与 Provider API Key 均正常可用 (AES-GCM-256)。</div>
          </div>
        </div>
        <button className="btn btn-secondary" onClick={lockVault}>
          <Lock size={14} /> 立即锁定 Vault
        </button>
      </div>
    );
  }

  // ============ 未初始化:首次设置主密码 ============
  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (!pass) { setErrorMsg('请输入主密码'); return; }
    if (pass.length < 6) { setErrorMsg('主密码至少 6 位'); return; }
    if (pass !== confirmPass) { setErrorMsg('两次输入的密码不一致'); return; }
    setBusy(true);
    const ok = await setupVault(pass);
    setBusy(false);
    if (!ok) {
      setErrorMsg('初始化失败,请重试');
    } else {
      setPass(''); setConfirmPass('');
    }
  };

  if (!isVaultInitialized) {
    return (
      <div className="glass-card" style={{ marginBottom: 20, borderLeft: '4px solid var(--apple-blue)', background: 'rgba(10, 132, 255, 0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div style={{ background: 'rgba(10, 132, 255, 0.2)', padding: 8, borderRadius: 8, color: 'var(--apple-blue)' }}>
            <Key size={20} />
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Vault 凭证库未启用(可选)</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              当前 SSH 密码 / API Key 以明文保存在项目 data 目录,所有功能可直接使用,无需解锁。
              启用后将用主密码派生密钥加密全部敏感数据(AES-GCM-256),此后每次启动需解锁。<strong>请务必牢记主密码,忘记将无法找回。</strong>
            </div>
          </div>
        </div>

        <form onSubmit={handleSetup} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ position: 'relative' }}>
            <Key size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-dim)' }} />
            <input
              type="password"
              className="input-field"
              placeholder="设置主密码(至少 6 位)"
              value={pass}
              onChange={e => { setPass(e.target.value); setErrorMsg(''); }}
              style={{ paddingLeft: 30 }}
            />
          </div>
          <div style={{ position: 'relative' }}>
            <Key size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-dim)' }} />
            <input
              type="password"
              className="input-field"
              placeholder="再次输入确认"
              value={confirmPass}
              onChange={e => { setConfirmPass(e.target.value); setErrorMsg(''); }}
              style={{ paddingLeft: 30 }}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy} style={{ alignSelf: 'flex-start' }}>
            <ShieldCheck size={14} /> {busy ? '正在启用...' : '启用 Vault 加密'}
          </button>
        </form>
        {errorMsg && <div style={{ color: 'var(--accent-rose)', fontSize: 12, marginTop: 8 }}>{errorMsg}</div>}
      </div>
    );
  }

  // ============ 已初始化未解锁:输入密码解锁 ============
  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (!pass) { setErrorMsg('请输入主密码'); return; }
    setBusy(true);
    const ok = await unlockVault(pass);
    setBusy(false);
    if (!ok) {
      setErrorMsg('主密码错误,无法解密 Vault 数据 key');
    } else {
      setPass('');
    }
  };

  return (
    <div className="glass-card" style={{ marginBottom: 20, borderLeft: '4px solid var(--accent-rose)', background: 'rgba(244, 63, 94, 0.05)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div style={{ background: 'rgba(244, 63, 94, 0.2)', padding: 8, borderRadius: 8, color: 'var(--accent-rose)' }}>
          <ShieldAlert size={20} />
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--accent-rose)' }}>Vault 凭证库处于锁定状态</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>已保护所有 SSH 加密凭证与敏感 API 密钥,需解锁后方可新建服务器或连接 SSH。</div>
        </div>
      </div>

      <form onSubmit={handleUnlock} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <Key size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-dim)' }} />
          <input
            type="password"
            className="input-field"
            placeholder="输入 Vault 主密码"
            value={pass}
            onChange={e => { setPass(e.target.value); setErrorMsg(''); }}
            style={{ paddingLeft: 30 }}
            autoFocus
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          <Unlock size={14} /> {busy ? '解锁中...' : '解锁凭证库'}
        </button>
      </form>
      {errorMsg && <div style={{ color: 'var(--accent-rose)', fontSize: 12, marginTop: 8 }}>{errorMsg}</div>}
    </div>
  );
};
