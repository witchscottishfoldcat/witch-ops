import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { FolderTree, Folder, FileText, ChevronRight, Edit3, HardDrive, RefreshCw, X } from 'lucide-react';

export const SftpBrowser: React.FC = () => {
  const { sftpPath, setSftpPath, sftpFiles, readSftpFile, writeSftpFile, activeServerId, servers } = useApp();
  const [selectedFile, setSelectedFile] = useState<{ path: string; name: string } | null>(null);
  const [fileContent, setFileContent] = useState('');

  const currentServer = servers.find(s => s.id === activeServerId);

  const handleItemClick = async (name: string, isDir: boolean) => {
    if (isDir) {
      const nextPath = sftpPath === '/' ? `/${name}` : `${sftpPath}/${name}`;
      setSftpPath(nextPath);
    } else {
      const fullPath = sftpPath === '/' ? `/${name}` : `${sftpPath}/${name}`;
      const content = await readSftpFile(fullPath);
      setSelectedFile({ path: fullPath, name });
      setFileContent(content);
    }
  };

  const pathParts = sftpPath.split('/').filter(Boolean);

  return (
    <div>
      <div className="page-title-row">
        <div>
          <h2 className="page-title">
            <FolderTree size={24} style={{ color: 'var(--accent-cyan)' }} />
            SFTP 远程文件管理器 (SFTP Operations)
          </h2>
          <p className="page-subtitle">直接在前端浏览与编辑远程节点文本配置文件，支持 UTF-8 自动检错与权限控制。</p>
        </div>
      </div>

      <div className="glass-card" style={{ marginBottom: 16, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {/* Breadcrumb Path */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontFamily: 'var(--font-mono)' }}>
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

        <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }}>
          <RefreshCw size={12} /> 刷新目录
        </button>
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
              <th>权限 (Permissions)</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {sftpFiles.map((item, idx) => (
              <tr key={idx} style={{ cursor: 'pointer' }} onClick={() => handleItemClick(item.name, item.is_dir)}>
                <td style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: item.is_dir ? 600 : 400 }}>
                  {item.is_dir ? (
                    <Folder size={16} style={{ color: 'var(--accent-amber)' }} />
                  ) : (
                    <FileText size={16} style={{ color: 'var(--accent-cyan)' }} />
                  )}
                  <span>{item.name}</span>
                </td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.is_dir ? '目录' : '文件'}</td>
                <td style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                  {item.is_dir ? '-' : `${(item.size / 1024).toFixed(1)} KB`}
                </td>
                <td style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                  {item.modified ? new Date(item.modified).toLocaleDateString() : '-'}
                </td>
                <td style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--accent-emerald)' }}>
                  {item.permissions ? `0${item.permissions}` : '0755'}
                </td>
                <td>
                  {!item.is_dir && (
                    <button className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: 11 }}>
                      <Edit3 size={12} /> 查看/修改
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* File Editor Modal */}
      {selectedFile && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: 720 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>在线编辑文件: {selectedFile.name}</h3>
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
              <button
                className="btn btn-primary"
                onClick={() => {
                  writeSftpFile(selectedFile.path, fileContent);
                  setSelectedFile(null);
                }}
              >
                保存写入服务器 (sftp_write_file)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
