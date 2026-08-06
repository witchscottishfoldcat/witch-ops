import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  Server, ServerInput, AuditLog, AuditFilter, Skill, QuickAction, Doc,
  Provider, ProviderInput, Container, ContainerAction, Service, ServerMetrics,
  DirEntry, AuditContext, ExecuteResult
} from '../types/backend';
import * as ipc from '../lib/ipc';

export interface TerminalTab {
  id: string;          // 前端 tab id(等于后端 terminal_id)
  serverId: number;
  serverName: string;
  title: string;
}

export interface AgentProposal {
  id: string;
  command: string;
  tool_name: string;
  server_id: number;
  approved?: boolean;
  result?: ExecuteResult;
  safe_to_run?: boolean;
}

export interface AgentMessage {
  id: string;
  sender: 'user' | 'agent' | 'system';
  content: string;
  timestamp: string;
  proposal?: AgentProposal;
  streaming?: boolean;
}

interface AppContextType {
  // Vault
  isVaultInitialized: boolean;
  isVaultUnlocked: boolean;
  unlockVault: (pass: string) => Promise<boolean>;
  lockVault: () => Promise<void>;
  setupVault: (pass: string) => Promise<boolean>;

  // Theme
  theme: string;
  setTheme: (t: string) => void;

  // Sidebar
  isSidebarCollapsed: boolean;
  toggleSidebar: () => void;

  // View / Server
  activeView: string;
  setActiveView: (view: string) => void;
  activeServerId: number | null;
  setActiveServerId: (id: number | null) => void;

  // Host Key
  pendingHostKey: { serverId: number; fingerprint: string } | null;
  confirmHostKey: () => Promise<void>;
  cancelHostKey: () => void;

  // Servers
  servers: Server[];
  connectedServerIds: Set<number>;
  refreshServers: () => Promise<void>;
  connectServer: (id: number) => Promise<void>;
  disconnectServer: (id: number) => Promise<void>;
  addServer: (input: ServerInput) => Promise<void>;
  updateServer: (id: number, input: ServerInput) => Promise<void>;
  deleteServer: (id: number) => Promise<void>;
  executeCommand: (serverId: number, command: string, ctx: AuditContext) => Promise<ExecuteResult>;

  // Terminals
  terminalTabs: TerminalTab[];
  activeTerminalId: string | null;
  setActiveTerminalId: (id: string | null) => void;
  openTerminal: (serverId: number, cols?: number, rows?: number) => Promise<void>;
  closeTerminal: (id: string) => Promise<void>;

  // Audit
  auditLogs: AuditLog[];
  auditStats: { total: number; success: number; failed: number };
  refreshAuditLogs: (filter?: AuditFilter) => Promise<void>;
  refreshAuditStats: () => Promise<void>;

  // Skills
  skills: Skill[];
  refreshSkills: () => Promise<void>;
  upsertSkill: (skill: Skill) => Promise<void>;
  toggleSkill: (id: string, enabled: boolean) => Promise<void>;
  deleteSkill: (id: string) => Promise<void>;

  // Quick Actions
  quickActions: QuickAction[];
  refreshQuickActions: () => Promise<void>;
  upsertQuickAction: (action: QuickAction) => Promise<void>;
  deleteQuickAction: (id: string) => Promise<void>;
  runQuickAction: (actionId: string, serverId: number) => Promise<void>;

  // Docs
  docs: Doc[];
  refreshDocs: () => Promise<void>;
  upsertDoc: (doc: Doc) => Promise<void>;
  updateDocStatus: (id: string, status: Doc['status']) => Promise<void>;
  deleteDoc: (id: string) => Promise<void>;
  convertDocToSkill: (docId: string, title: string) => Promise<void>;

  // SFTP
  sftpPath: string;
  setSftpPath: (path: string) => void;
  sftpFiles: DirEntry[];
  refreshSftpFiles: () => Promise<void>;
  readSftpFile: (path: string) => Promise<string | null>;
  writeSftpFile: (path: string, content: string) => Promise<void>;
  deleteSftpEntry: (path: string, isDir: boolean) => Promise<void>;
  createSftpDir: (path: string) => Promise<void>;

  // Metrics
  metrics: ServerMetrics | null;
  refreshMetrics: () => Promise<void>;

  // Containers & Services
  containers: Container[];
  refreshContainers: () => Promise<void>;
  controlContainer: (containerId: string, action: ContainerAction['action']) => Promise<void>;
  services: Service[];
  refreshServices: () => Promise<void>;
  controlService: (serviceName: string, action: string) => Promise<void>;

  // Providers
  providers: Provider[];
  refreshProviders: () => Promise<void>;
  addProvider: (input: ProviderInput) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;

  // Errors
  lastError: string | null;
  clearError: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState('macos-dark');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isVaultInitialized, setIsVaultInitialized] = useState(false);
  const [isVaultUnlocked, setIsVaultUnlocked] = useState(false);
  const [activeView, setActiveView] = useState('servers');
  const [activeServerId, setActiveServerId] = useState<number | null>(null);
  const [pendingHostKey, setPendingHostKey] = useState<{ serverId: number; fingerprint: string } | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  // Data
  const [servers, setServers] = useState<Server[]>([]);
  const [connectedServerIds, setConnectedServerIds] = useState<Set<number>>(new Set());
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditStats, setAuditStats] = useState({ total: 0, success: 0, failed: 0 });
  const [skills, setSkills] = useState<Skill[]>([]);
  const [quickActions, setQuickActions] = useState<QuickAction[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [sftpPath, setSftpPath] = useState('/');
  const [sftpFiles, setSftpFiles] = useState<DirEntry[]>([]);
  const [metrics, setMetrics] = useState<ServerMetrics | null>(null);
  const [containers, setContainers] = useState<Container[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);

  const clearError = () => setLastError(null);

  const handleError = (e: unknown) => {
    const msg = e && typeof e === 'object' && 'message' in e ? String((e as any).message) : String(e);
    setLastError(msg);
    console.error('[Witchcat Ops]', e);
  };

  // 后台周期性任务(轮询)的错误:只记日志,不弹全局 toast(避免打扰)
  const silentError = (e: unknown) => {
    console.warn('[Witchcat Ops 后台任务]', e);
  };

  const setTheme = (t: string) => {
    setThemeState(t);
    document.documentElement.setAttribute('data-theme', t);
  };
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);
  const toggleSidebar = () => setIsSidebarCollapsed(p => !p);

  // ============ Vault ============
  const refreshVaultState = useCallback(async () => {
    try {
      const init = await ipc.vaultIsInitialized();
      setIsVaultInitialized(init);
      if (init) setIsVaultUnlocked(await ipc.vaultIsUnlocked());
    } catch (e) { handleError(e); }
  }, []);

  useEffect(() => { refreshVaultState(); }, [refreshVaultState]);

  const setupVault = async (pass: string) => {
    try { await ipc.vaultSetup(pass); await refreshVaultState(); return true; }
    catch (e) { handleError(e); return false; }
  };
  const unlockVault = async (pass: string) => {
    try { await ipc.vaultUnlock(pass); await refreshVaultState(); return true; }
    catch (e) { handleError(e); return false; }
  };
  const lockVault = async () => {
    try { await ipc.vaultLock(); setIsVaultUnlocked(false); } catch (e) { handleError(e); }
  };

  // ============ Servers ============
  const refreshServers = useCallback(async () => {
    try {
      const list = await ipc.listServers();
      setServers(list);
      const connected = new Set<number>();
      for (const s of list) {
        if (await ipc.serverConnectionStatus(s.id)) connected.add(s.id);
      }
      setConnectedServerIds(connected);
    } catch (e) { handleError(e); }
  }, []);

  useEffect(() => { refreshServers(); }, [refreshServers]);

  const connectServer = async (id: number) => {
    try {
      const fp = await ipc.connectServer(id);
      const s = servers.find(x => x.id === id);
      if (s && !s.host_key_fingerprint && fp) {
        setPendingHostKey({ serverId: id, fingerprint: fp });
        return;
      }
      setConnectedServerIds(prev => new Set([...prev, id]));
    } catch (e) { handleError(e); }
  };

  const confirmHostKey = async () => {
    if (!pendingHostKey) return;
    try {
      await ipc.confirmHostKey(pendingHostKey.serverId, pendingHostKey.fingerprint);
      setConnectedServerIds(prev => new Set([...prev, pendingHostKey.serverId]));
      setPendingHostKey(null);
      await refreshServers();
    } catch (e) { handleError(e); }
  };
  const cancelHostKey = () => setPendingHostKey(null);

  const disconnectServer = async (id: number) => {
    try {
      await ipc.disconnectServer(id);
      setConnectedServerIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    } catch (e) { handleError(e); }
  };

  const addServer = async (input: ServerInput) => {
    try { await ipc.createServer(input); await refreshServers(); } catch (e) { handleError(e); }
  };
  const updateServer = async (id: number, input: ServerInput) => {
    try { await ipc.updateServer(id, input); await refreshServers(); } catch (e) { handleError(e); }
  };
  const deleteServer = async (id: number) => {
    try { await ipc.deleteServer(id); await refreshServers(); } catch (e) { handleError(e); }
  };

  const executeCommand = async (serverId: number, command: string, ctx: AuditContext) => {
    try {
      const result = await ipc.executeCommand(serverId, command, ctx);
      refreshAuditLogs();
      refreshAuditStats();
      return result;
    } catch (e) { handleError(e); throw e; }
  };

  // ============ Terminals ============
  const openTerminal = async (serverId: number, cols?: number, rows?: number) => {
    try {
      const s = servers.find(x => x.id === serverId);
      if (!s) return;
      if (!connectedServerIds.has(serverId)) await connectServer(serverId);

      // 预生成 terminal_id,先注册监听缓冲输出,再开 PTY
      // (解决时序:后端开 PTY 立即推数据,若前端监听未建立会丢初始输出)
      const termId = `term_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
      ipc.frontendLog(`openTerminal 开始 id=${termId.slice(0, 16)} server=${serverId}`);
      await ipc.beginTerminalBuffer(termId);
      await ipc.terminalOpen(serverId, cols ?? 80, rows ?? 24, termId);
      ipc.frontendLog(`openTerminal PTY 已开 id=${termId.slice(0, 16)}`);

      const tab: TerminalTab = {
        id: termId, serverId, serverName: s.name,
        title: `${s.name} (${s.host})`,
      };
      setTerminalTabs(prev => [...prev, tab]);
      setActiveTerminalId(termId);
      setActiveView('terminal');
    } catch (e) { handleError(e); }
  };

  const closeTerminal = async (id: string) => {
    try { await ipc.terminalClose(id); } catch {}
    ipc.disposeTerminalBuffer(id);
    setTerminalTabs(prev => {
      const next = prev.filter(t => t.id !== id);
      if (activeTerminalId === id) setActiveTerminalId(next[0]?.id ?? null);
      return next;
    });
  };

  // ============ Audit ============
  const refreshAuditLogs = useCallback(async (filter?: AuditFilter) => {
    try { setAuditLogs(await ipc.queryAuditLogs(filter ?? {})); } catch (e) { handleError(e); }
  }, []);
  const refreshAuditStats = useCallback(async () => {
    try { setAuditStats(await ipc.auditStats()); } catch (e) { handleError(e); }
  }, []);

  useEffect(() => { refreshAuditLogs(); refreshAuditStats(); }, [refreshAuditLogs, refreshAuditStats]);

  // ============ Skills ============
  const refreshSkills = useCallback(async () => {
    try { setSkills(await ipc.listSkills()); } catch (e) { handleError(e); }
  }, []);
  useEffect(() => { refreshSkills(); }, [refreshSkills]);

  const upsertSkill = async (skill: Skill) => {
    try { await ipc.upsertSkill(skill); await refreshSkills(); } catch (e) { handleError(e); }
  };
  const toggleSkill = async (id: string, enabled: boolean) => {
    try { await ipc.toggleSkill(id, enabled); await refreshSkills(); } catch (e) { handleError(e); }
  };
  const deleteSkill = async (id: string) => {
    try { await ipc.deleteSkill(id); await refreshSkills(); } catch (e) { handleError(e); }
  };

  // ============ Quick Actions ============
  const refreshQuickActions = useCallback(async () => {
    try { setQuickActions(await ipc.listQuickActions()); } catch (e) { handleError(e); }
  }, []);
  useEffect(() => { refreshQuickActions(); }, [refreshQuickActions]);

  const upsertQuickAction = async (action: QuickAction) => {
    try { await ipc.upsertQuickAction(action); await refreshQuickActions(); } catch (e) { handleError(e); }
  };
  const deleteQuickAction = async (id: string) => {
    try { await ipc.deleteQuickAction(id); await refreshQuickActions(); } catch (e) { handleError(e); }
  };
  const runQuickAction = async (actionId: string, serverId: number) => {
    const qa = quickActions.find(a => a.id === actionId);
    if (!qa) return;
    try {
      const steps = JSON.parse(qa.steps) as { type: string; value: string }[];
      for (const step of steps) {
        if (step.type === 'command') {
          await executeCommand(serverId, step.value, {
            source: 'quick_action',
            tool_name: 'run_quick_action',
            approved_by: qa.approval === 'always_approve' ? 'policy:auto_review' : 'user:quick_action',
          });
        }
      }
    } catch (e) { handleError(e); }
  };

  // ============ Docs ============
  const refreshDocs = useCallback(async () => {
    try { setDocs(await ipc.listDocs()); } catch (e) { handleError(e); }
  }, []);
  useEffect(() => { refreshDocs(); }, [refreshDocs]);

  const upsertDoc = async (doc: Doc) => {
    try { await ipc.upsertDoc(doc); await refreshDocs(); } catch (e) { handleError(e); }
  };
  const updateDocStatus = async (id: string, status: Doc['status']) => {
    try { await ipc.updateDocStatus(id, status); await refreshDocs(); } catch (e) { handleError(e); }
  };
  const deleteDoc = async (id: string) => {
    try { await ipc.deleteDoc(id); await refreshDocs(); } catch (e) { handleError(e); }
  };
  const convertDocToSkill = async (docId: string, title: string) => {
    try {
      await ipc.docToSkill(docId, `skill_${docId}`, title);
      await refreshSkills();
      setActiveView('skills');
    } catch (e) { handleError(e); }
  };

  // ============ SFTP ============
  const refreshSftpFiles = useCallback(async () => {
    if (!activeServerId) return;
    // 目录导航是用户主动操作,失败必须弹错误(无权限/不存在等)
    try { setSftpFiles(await ipc.sftpListDir(activeServerId, sftpPath)); }
    catch (e) { handleError(e); setSftpFiles([]); }
  }, [activeServerId, sftpPath]);
  useEffect(() => { refreshSftpFiles(); }, [refreshSftpFiles]);

  // 切换服务器后路径重置到根目录(避免在 B 服务器访问 A 服务器的路径)
  const prevSftpServerRef = useRef(activeServerId);
  useEffect(() => {
    if (prevSftpServerRef.current !== activeServerId) {
      prevSftpServerRef.current = activeServerId;
      setSftpPath('/');
    }
  }, [activeServerId]);

  const readSftpFile = async (path: string): Promise<string | null> => {
    if (!activeServerId) return null;
    try { return await ipc.sftpReadFile(activeServerId, path); }
    catch (e) { handleError(e); return null; }
  };
  const writeSftpFile = async (path: string, content: string) => {
    if (!activeServerId) throw new Error('未选择服务器');
    try {
      await ipc.sftpWriteFile(activeServerId, path, content);
      await refreshSftpFiles();
    } catch (e) { handleError(e); throw e; }
  };
  const deleteSftpEntry = async (path: string, isDir: boolean) => {
    if (!activeServerId) return;
    try {
      if (isDir) await ipc.sftpRmdir(activeServerId, path);
      else await ipc.sftpDeleteFile(activeServerId, path);
      await refreshSftpFiles();
    } catch (e) { handleError(e); }
  };
  const createSftpDir = async (path: string) => {
    if (!activeServerId) return;
    try { await ipc.sftpMkdir(activeServerId, path); await refreshSftpFiles(); }
    catch (e) { handleError(e); }
  };

  // ============ Metrics ============
  const refreshMetrics = useCallback(async () => {
    if (!activeServerId) return;
    // 后台轮询:失败静默(只记日志),不弹全局错误
    try { setMetrics(await ipc.getMetrics(activeServerId)); } catch (e) { silentError(e); }
  }, [activeServerId]);
  useEffect(() => {
    refreshMetrics();
    const t = setInterval(refreshMetrics, 5000); // 每 5 秒刷新
    return () => clearInterval(t);
  }, [refreshMetrics]);

  // ============ Containers & Services ============
  // 后台自动刷新:失败静默;用户主动操作(controlContainer/controlService):失败弹提示
  const refreshContainers = useCallback(async () => {
    if (!activeServerId) return;
    try { setContainers(await ipc.listContainers(activeServerId)); } catch (e) { silentError(e); }
  }, [activeServerId]);
  useEffect(() => { refreshContainers(); }, [refreshContainers]);

  const controlContainer = async (containerId: string, action: ContainerAction['action']) => {
    if (!activeServerId) return;
    try {
      await ipc.controlContainer(activeServerId, { container_id: containerId, action });
      await refreshContainers();
    } catch (e) { handleError(e); }
  };

  const refreshServices = useCallback(async () => {
    if (!activeServerId) return;
    try { setServices(await ipc.listServices(activeServerId)); } catch (e) { silentError(e); }
  }, [activeServerId]);
  useEffect(() => { refreshServices(); }, [refreshServices]);

  const controlService = async (serviceName: string, action: string) => {
    if (!activeServerId) return;
    try {
      await ipc.controlService(activeServerId, serviceName, action);
      await refreshServices();
    } catch (e) { handleError(e); }
  };

  // ============ Providers ============
  const refreshProviders = useCallback(async () => {
    try { setProviders(await ipc.listProviders()); } catch (e) { handleError(e); }
  }, []);
  useEffect(() => { refreshProviders(); }, [refreshProviders]);

  const addProvider = async (input: ProviderInput) => {
    try { await ipc.createProvider(input); await refreshProviders(); } catch (e) { handleError(e); }
  };
  const deleteProvider = async (id: string) => {
    try { await ipc.deleteProvider(id); await refreshProviders(); } catch (e) { handleError(e); }
  };

  return (
    <AppContext.Provider value={{
      theme, setTheme, isSidebarCollapsed, toggleSidebar,
      isVaultInitialized, isVaultUnlocked, unlockVault, lockVault, setupVault,
      activeView, setActiveView, activeServerId, setActiveServerId,
      pendingHostKey, confirmHostKey, cancelHostKey,
      servers, connectedServerIds, refreshServers, connectServer, disconnectServer,
      addServer, updateServer, deleteServer, executeCommand,
      terminalTabs, activeTerminalId, setActiveTerminalId, openTerminal, closeTerminal,
      auditLogs, auditStats, refreshAuditLogs, refreshAuditStats,
      skills, refreshSkills, upsertSkill, toggleSkill, deleteSkill,
      quickActions, refreshQuickActions, upsertQuickAction, deleteQuickAction, runQuickAction,
      docs, refreshDocs, upsertDoc, updateDocStatus, deleteDoc, convertDocToSkill,
      sftpPath, setSftpPath, sftpFiles, refreshSftpFiles, readSftpFile, writeSftpFile,
      deleteSftpEntry, createSftpDir,
      metrics, refreshMetrics,
      containers, refreshContainers, controlContainer,
      services, refreshServices, controlService,
      providers, refreshProviders, addProvider, deleteProvider,
      lastError, clearError,
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};
