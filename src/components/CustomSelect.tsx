import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
  color?: string;
}

interface CustomSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (val: string) => void;
  icon?: React.ReactNode;
  placeholder?: string;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({ options, value, onChange, icon, placeholder }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOpt = options.find(o => o.value === value) || options[0];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const triggerStyle: React.CSSProperties = {
    height: 30,
    padding: '4px 10px',
    fontSize: 12,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: 'rgba(128, 128, 128, 0.12)',
    border: '1px solid var(--apple-border)',
    borderRadius: 'var(--apple-radius-sm)',
    color: selectedOpt ? 'var(--apple-text)' : 'var(--apple-text-muted)',
    cursor: selectedOpt ? 'pointer' : 'not-allowed'
  };

  // 空 options 时渲染禁用占位,不崩溃
  if (!selectedOpt) {
    return (
      <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
        <button type="button" className="btn btn-secondary" disabled style={triggerStyle}>
          {icon}
          <span>{placeholder || '无可用选项'}</span>
          <ChevronDown size={12} style={{ opacity: 0.6 }} />
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      {/* Trigger Button */}
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setIsOpen(!isOpen)}
        style={triggerStyle}
      >
        {icon}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{selectedOpt.icon} {selectedOpt.label}</span>
        <ChevronDown size={12} style={{ opacity: 0.6, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }} />
      </button>

      {/* Popover Dropdown Menu */}
      {isOpen && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          right: 0,
          minWidth: 170,
          background: 'var(--apple-popover-bg)',
          backdropFilter: 'var(--apple-blur)',
          border: '1px solid var(--apple-border-light)',
          borderRadius: 'var(--apple-radius-md)',
          padding: '4px',
          boxShadow: 'var(--apple-shadow)',
          zIndex: 999,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          animation: 'macModalIn 0.15s ease-out'
        }}>
          {options.map(opt => {
            const isSelected = opt.value === value;
            return (
              <div
                key={opt.value}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '7px 10px',
                  borderRadius: 'var(--apple-radius-sm)',
                  fontSize: 12,
                  fontWeight: isSelected ? 600 : 400,
                  color: isSelected ? '#ffffff' : 'var(--apple-text)',
                  background: isSelected ? 'var(--apple-blue)' : 'transparent',
                  cursor: 'pointer',
                  transition: 'all 0.12s ease'
                }}
                className="custom-select-item"
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>{opt.icon}</span>
                  <span>{opt.label}</span>
                </div>
                {isSelected && <Check size={14} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
