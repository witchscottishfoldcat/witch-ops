import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Lock, Unlock, Key, ShieldCheck, ShieldAlert, LifeBuoy, Trash2 } from 'lucide-react';

/**
 * Vault 凭证库卡片
 *
 * 三种状态:
 * 1. 未初始化(首次使用)→ 设置主密码(创建 Vault)
 * 2. 已初始化但未解锁 → 输入主密码解锁
 * 3. 已解锁 → 显示状态 + 锁定按钮
 */
export const VaultModal: React.FC = () => {
  const { isVaultInitialized, isVaultUnlocked, unlockVault, lockVault, setupVault, recoverVault, resetVault } = useApp();
  const [pass, setPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [busy, setBusy] = useState(false);
  // 忘记密码恢复区
  const [showRecover, setShowRecover] = useState(false);
  const [newPass, setNewPass] = useState('');
  const [newPass2, setNewPass2] = useState('');
  const [recoverMsg, setRecoverMsg] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);

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
      <div className="glass-card" style={{ marginBottom: 20, borderLeft: '4px solid var(--apple-blue)', background: 'var(--info-bg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div style={{ background: 'var(--info-bg)', padding: 8, borderRadius: 8, color: 'var(--accent-blue)' }}>
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

  // 钥匙串恢复:重设主密码(凭证保留)
  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecoverMsg('');
    if (newPass.length < 6) { setRecoverMsg('新主密码至少 6 位'); return; }
    if (newPass !== newPass2) { setRecoverMsg('两次输入的密码不一致'); return; }
    setBusy(true);
    const ok = await recoverVault(newPass);
    setBusy(false);
    if (ok) {
      setShowRecover(false);
      setNewPass(''); setNewPass2('');
    }
    // 失败时错误已由全局 toast 展示(如"钥匙串中没有备份")
  };

  // 彻底重置(两步确认)
  const handleReset = async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 3000);
      return;
    }
    setBusy(true);
    await resetVault();
    setBusy(false);
    setConfirmReset(false);
    setShowRecover(false);
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

      {/* 忘记密码入口 */}
      <div style={{ marginTop: 10, fontSize: 12 }}>
        <span
          style={{ color: 'var(--accent-cyan)', cursor: 'pointer' }}
          onClick={() => { setShowRecover(!showRecover); setRecoverMsg(''); }}
        >
          忘记主密码?
        </span>
      </div>

      {showRecover && (
        <div style={{ marginTop: 10, padding: 12, borderRadius: 8, background: 'var(--panel-inset-bg)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* 方案一:钥匙串恢复 */}
          <form onSubmit={handleRecover}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <LifeBuoy size={13} style={{ color: 'var(--accent-emerald)' }} /> 用本机钥匙串恢复(推荐)
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
              data key 在本 Windows 账户的凭据管理器里有备份,可用它直接重设主密码,<strong>已存凭证全部保留</strong>。
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                type="password"
                className="input-field"
                placeholder="新主密码(至少 6 位)"
                value={newPass}
                onChange={e => { setNewPass(e.target.value); setRecoverMsg(''); }}
                style={{ fontSize: 12, height: 32 }}
              />
              <input
                type="password"
                className="input-field"
                placeholder="再次输入确认"
                value={newPass2}
                onChange={e => { setNewPass2(e.target.value); setRecoverMsg(''); }}
                style={{ fontSize: 12, height: 32 }}
              />
              <button type="submit" className="btn btn-primary" disabled={busy} style={{ alignSelf: 'flex-start', fontSize: 12 }}>
                <LifeBuoy size={13} /> {busy ? '恢复中...' : '重设主密码并解锁'}
              </button>
            </div>
            {recoverMsg && <div style={{ color: 'var(--accent-rose)', fontSize: 12, marginTop: 6 }}>{recoverMsg}</div>}
          </form>

          {/* 方案二:彻底重置 */}
          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Trash2 size={13} style={{ color: 'var(--accent-rose)' }} /> 彻底重置(钥匙串也没有备份时)
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
              删除 Vault 并清空所有已存凭证(服务器密码、API Key 需重新填写),<strong>不可恢复</strong>。
            </div>
            <button
              className="btn btn-danger"
              style={{ fontSize: 12 }}
              disabled={busy}
              onClick={handleReset}
            >
              <Trash2 size={13} /> {confirmReset ? '再点一次确认清空!' : '重置 Vault'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
