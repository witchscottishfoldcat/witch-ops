import React, { useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { X, AlertCircle } from 'lucide-react';

export const ErrorToast: React.FC = () => {
  const { lastError, clearError } = useApp();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!lastError) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => clearError(), 5000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [lastError, clearError]);

  if (!lastError) return null;

  return (
    <div
      className="glass-card"
      style={{
        position: 'fixed',
        top: 20,
        right: 20,
        zIndex: 200,
        maxWidth: 360,
        padding: '14px 16px',
        borderRadius: 'var(--apple-radius-md)',
        borderLeft: '4px solid var(--apple-red)',
        background: 'rgba(255, 69, 58, 0.12)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        boxShadow: 'var(--apple-shadow)',
        animation: 'macModalIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <AlertCircle size={18} style={{ color: 'var(--apple-red)', flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--apple-text)', marginBottom: 4 }}>发生错误</div>
        <div style={{ fontSize: 12, color: 'var(--apple-text-muted)', lineHeight: 1.5, wordBreak: 'break-word' }}>{lastError}</div>
      </div>
      <button
        type="button"
        onClick={clearError}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--apple-text-muted)',
          padding: 2,
          borderRadius: 4,
          display: 'flex',
          flexShrink: 0,
        }}
        title="关闭"
      >
        <X size={16} />
      </button>
    </div>
  );
};
