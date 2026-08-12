import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  FolderTree, Folder, FileText, ChevronRight, HardDrive, RefreshCw, X,
  FolderPlus, Trash2, Link2, ArrowUp, Check, Upload, Download,
} from 'lucide-react';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import * as ipc from '../lib/ipc';
import type { DirEntry } from '../types/backend';

/** 文件大小格式化 */
const fmtSize = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
};

/** unix mode → 八进制权限串(后端给的是含文件类型位的原始 mode) */
const fmtPerm = (p: number | null): string => {
  if (p == null) return '-';
  return (p & 0o7777).toString(8).padStart(4, '0');
};

const joinPath = (base: string, name: string) => (base === '/' ? `/${name}` : `${base}/${name}`);
const parentPath = (p: string) => {
  const parts = p.split('/').filter(Boolean);
  parts.pop();
  return parts.length === 0 ? '/' : '/' + parts.join('/');
};

export const SftpBrowser: React.FC = () => {
  const {
    sftpPath, setSftpPath, sftpFiles, sftpError, refreshSftpFiles,
    readSftpFile, writeSftpFile, deleteSftpEntry, createSftpDir,
    activeServerId, servers,
  } = useApp();

  const [selectedFile, setSelectedFile] = useState<{ path: string; name: string } | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [creatingDir, setCreatingDir] = useState(false);
  const [newDirName, setNewDirName] = useState('');
  // 两步删除:第一次点击进入确认态,3 秒内再点才真删
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // 请求代际:快速点击不同文件时,丢弃过期响应,防止覆盖编辑内容
  const fileSeqRef = useRef(0);
  // 文件传输(上传/下载)状态提示
  const [transferStatus, setTransferStatus] = useState<string | null>(null);

  const currentServer = servers.find(s => s.id === activeServerId);
  const pathParts = sftpPath.split('/').filter(Boolean);

  // 确认删除态 3 秒自动复位
  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(null), 3000);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  const openFile = async (fullPath: string, name: string) => {
    setLoadingFile(true);
    const seq = ++fileSeqRef.current;
    try {
      const content = await readSftpFile(fullPath);
      if (seq !== fileSeqRef.current) return; // 过期响应,丢弃
      if (content === null) return; // 错误已由全局 toast 提示
      setSelectedFile({ path: fullPath, name });
      setFileContent(content);
    } finally {
      if (seq === fileSeqRef.current) setLoadingFile(false);
    }
  };

  const handleItemClick = async (item: DirEntry) => {
    const fullPath = joinPath(sftpPath, item.name);
    if (item.is_symlink) {
      // 符号链接:stat 跟随到目标,是目录就进,是文件就读
      if (!activeServerId) return;
      try {
        const info = await ipc.sftpStat(activeServerId, fullPath);
        if (info.exists && info.is_dir) { setSftpPath(fullPath); return; }
        if (info.exists) { await openFile(fullPath, item.name); return; }
      } catch { /* 落到下面按普通文件处理,错误会弹 toast */ }
      return;
    }
    if (item.is_dir) {
      setSftpPath(fullPath);
    } else {
      await openFile(fullPath, item.name);
    }
  };

  const handleDelete = async (item: DirEntry) => {
    const fullPath = joinPath(sftpPath, item.name);
    if (confirmDelete !== fullPath) {
      setConfirmDelete(fullPath);
      return;
    }
    setConfirmDelete(null);
    await deleteSftpEntry(fullPath, item.is_dir);
  };

  const handleCreateDir = async () => {
    const name = newDirName.trim();
    if (!name) return;
    if (name.includes('/')) return; // 不允许嵌套路径,保持简单
    setCreatingDir(false);
    setNewDirName('');
    await createSftpDir(joinPath(sftpPath, name));
  };

  const handleSave = async () => {
    if (!selectedFile) return;
    setSaving(true);
    try {
      await writeSftpFile(selectedFile.path, fileContent);
      setSelectedFile(null);
    } catch { /* 错误 toast 已由 context 弹出,保持编辑框不丢内容 */ }
    finally { setSaving(false); }
  };

  // 上传本地文件到当前远程目录
  const handleUpload = async () => {
    if (!activeServerId) return;
    try {
      const selected = await openDialog({ multiple: false });
      if (!selected || typeof selected !== 'string') return;
      const fileName = selected.split(/[\\/]/).pop() || 'upload';
      const remotePath = joinPath(sftpPath, fileName);
      setTransferStatus(`正在上传 ${fileName}…`);
      await ipc.sftpUpload(activeServerId, selected, remotePath);
      await refreshSftpFiles();
    } catch (e) {
      // 用户取消对话框不报错,其他错误走全局 toast
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('Cancel')) console.error('[SFTP 上传]', e);
    } finally {
      setTransferStatus(null);
    }
  };

  // 下载远程文件到本地
  const handleDownload = async (item: DirEntry) => {
    if (!activeServerId) return;
    const remotePath = joinPath(sftpPath, item.name);
    try {
      const localPath = await saveDialog({ defaultPath: item.name });
      if (!localPath) return; // 用户取消
      setTransferStatus(`正在下载 ${item.name}…`);
      await ipc.sftpDownload(activeServerId, remotePath, localPath);
    } catch (e) {
      console.error('[SFTP 下载]', e);
    } finally {
      setTransferStatus(null);
    }
  };

  return (
    <div>
      <div className="page-title-row">
        <div>
          <h2 className="page-title">
            <FolderTree size={24} style={{ color: 'var(--accent-cyan)' }} />
            SFTP 远程文件管理器 (SFTP Operations)
          </h2>
          <p className="page-subtitle">直接在前端浏览与编辑远程节点文本配置文件,支持 UTF-8 自动检错与权限控制。</p>
        </div>
      </div>

      <div className="glass-card" style={{ marginBottom: 16, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {/* Breadcrumb Path */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontFamily: 'var(--font-mono)', flexWrap: 'wrap' }}>
          <HardDrive size={16} style={{ color: 'var(--accent-purple)' }} />
          <span style={{ color: 'var(--text-muted)' }}>{currentServer?.name || 'Server'}:</span>
          <span style={{ cursor: 'pointer', color: 'var(--accent-cyan)' }} onClick={() => setSftpPath('/')}>/</span>
          {pathParts.map((part, idx) => (
            <React.Fragment key={idx}>
              <ChevronRight size={12} style={{ color: 'var(--text-dim)' }} />
              <span
                style={{ cursor: 'pointer', color: idx === pathParts.length - 1 ? '#fff' : 'var(--accent-cyan)' }}
                onClick={() => setSftpPath('/' + pathParts.slice(0, idx + 1).join('/'))}
              >
                {part}
              </span>
            </React.Fragment>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-primary"
            style={{ padding: '4px 10px', fontSize: 12 }}
            onClick={handleUpload}
            disabled={!activeServerId || !!transferStatus}
            title="上传本地文件到当前目录"
          >
            <Upload size={12} /> 上传
          </button>
          <button
            className="btn btn-secondary"
            style={{ padding: '4px 10px', fontSize: 12 }}
            onClick={() => { setNewDirName(''); setCreatingDir(true); }}
            title="在当前目录新建文件夹"
          >
            <FolderPlus size={12} /> 新建目录
          </button>
          <button
            className="btn btn-secondary"
            style={{ padding: '4px 10px', fontSize: 12 }}
            onClick={() => refreshSftpFiles()}
          >
            <RefreshCw size={12} /> 刷新目录
          </button>
        </div>
      </div>

      {/* File List Table */}
      <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>类型</th>
              <th>大小</th>
              <th>修改时间</th>
              <th>权限</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {/* 上一级 */}
            {sftpPath !== '/' && (
              <tr style={{ cursor: 'pointer' }} onClick={() => setSftpPath(parentPath(sftpPath))}>
                <td style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}>
                  <ArrowUp size={16} /> <span>..</span>
                </td>
                <td colSpan={5} style={{ fontSize: 12, color: 'var(--text-dim)' }}>上一级目录</td>
              </tr>
            )}

            {/* 新建目录内联输入行 */}
            {creatingDir && (
              <tr>
                <td colSpan={6}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FolderPlus size={16} style={{ color: 'var(--accent-amber)' }} />
                    <input
                      className="input-field"
                      style={{ flex: 1, height: 28, fontSize: 12 }}
                      placeholder="输入新目录名,回车创建"
                      value={newDirName}
                      autoFocus
                      onChange={e => setNewDirName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleCreateDir();
                        if (e.key === 'Escape') setCreatingDir(false);
                      }}
                    />
                    <button className="btn btn-primary" style={{ padding: '2px 10px', fontSize: 11 }} onClick={handleCreateDir}>
                      <Check size={12} /> 创建
                    </button>
                    <button className="btn btn-secondary" style={{ padding: '2px 10px', fontSize: 11 }} onClick={() => setCreatingDir(false)}>
                      取消
                    </button>
                  </div>
                </td>
              </tr>
            )}

            {sftpFiles.map((item) => {
              const fullPath = joinPath(sftpPath, item.name);
              const confirming = confirmDelete === fullPath;
              return (
                <tr key={item.name} style={{ cursor: 'pointer' }} onClick={() => handleItemClick(item)}>
                  <td style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: item.is_dir ? 600 : 400 }}>
                    {item.is_symlink ? (
                      <Link2 size={16} style={{ color: 'var(--accent-purple)' }} />
                    ) : item.is_dir ? (
                      <Folder size={16} style={{ color: 'var(--accent-amber)' }} />
                    ) : (
                      <FileText size={16} style={{ color: 'var(--accent-cyan)' }} />
                    )}
                    <span>{item.name}</span>
                    {item.is_symlink && <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>(链接)</span>}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {item.is_symlink ? '符号链接' : item.is_dir ? '目录' : '文件'}
                  </td>
                  <td style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                    {item.is_dir ? '-' : fmtSize(item.size)}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                    {item.modified ? new Date(item.modified).toLocaleString() : '-'}
                  </td>
                  <td style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--accent-emerald)' }}>
                    {fmtPerm(item.permissions)}
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {!item.is_dir && !item.is_symlink && (
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '2px 8px', fontSize: 11 }}
                          onClick={() => handleDownload(item)}
                          title="下载到本地"
                        >
                          <Download size={12} />
                        </button>
                      )}
                      <button
                        className="btn btn-secondary"
                        style={{
                          padding: '2px 8px', fontSize: 11,
                          color: confirming ? '#fff' : undefined,
                          background: confirming ? 'var(--accent-rose)' : undefined,
                          borderColor: confirming ? 'var(--accent-rose)' : undefined,
                        }}
                        onClick={() => handleDelete(item)}
                        title={confirming ? '再次点击确认删除' : '删除'}
                      >
                        <Trash2 size={12} /> {confirming ? '确认删除?' : '删除'}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {sftpFiles.length === 0 && !creatingDir && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: 24, fontSize: 12 }}>
                  {sftpError ? (
                    <div>
                      <div style={{ color: 'var(--accent-rose)', marginBottom: 8 }}>目录读取失败: {sftpError}</div>
                      <button className="btn btn-secondary" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => refreshSftpFiles()}>
                        <RefreshCw size={11} /> 重试
                      </button>
                    </div>
                  ) : (
                    <span style={{ color: 'var(--text-dim)' }}>
                      {activeServerId ? '空目录' : '请先选择服务器'}
                    </span>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* File Editor Modal */}
      {selectedFile && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: 720 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>在线编辑: {selectedFile.name}</h3>
              <button className="btn btn-secondary" style={{ padding: 4 }} onClick={() => setSelectedFile(null)}><X size={16} /></button>
            </div>

            <textarea
              className="input-field"
              rows={16}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.5, marginBottom: 16 }}
              value={fileContent}
              onChange={e => setFileContent(e.target.value)}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button className="btn btn-secondary" onClick={() => setSelectedFile(null)}>取消</button>
              <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
                {saving ? '写入中…' : '保存写入服务器'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 读取文件中的轻提示 */}
      {loadingFile && (
        <div style={{ position: 'fixed', bottom: 20, right: 20, fontSize: 12, color: 'var(--text-muted)', background: 'var(--apple-popover-bg)', padding: '6px 12px', borderRadius: 8, border: '1px solid var(--apple-border)' }}>
          正在读取文件…
        </div>
      )}

      {/* 文件传输中提示 */}
      {transferStatus && (
        <div style={{
          position: 'fixed', bottom: 20, right: 20, fontSize: 12,
          color: 'var(--accent-cyan)', background: 'var(--apple-popover-bg)',
          padding: '8px 14px', borderRadius: 8, border: '1px solid var(--accent-cyan)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Upload size={14} style={{ animation: 'spin 2s linear infinite' }} />
          {transferStatus}
        </div>
      )}
    </div>
  );
};
