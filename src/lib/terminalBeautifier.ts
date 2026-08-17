/**
 * 纯前端终端流实时智能语法高亮与实时输入校验引擎 (Fish / Warp 风格)
 *
 * 核心能力:
 * 1. 消除 Linux 原生 ls 对 777 权限目录盲目添加的刺眼绿色背景块 (Blue on Green BG -> 清晰亮蓝目录)
 * 2. 交互式键盘输入实时语法校验与着色 (有效命令翡翠绿、输错标红检查、子命令琥珀黄、参数粉紫、字符串金黄)
 * 3. Linux 提示符双色胶囊分段 (Purple User@Host + Teal Path + Emerald Arrow)
 * 4. 完美兼容 ~ 家目录与任意深层路径 (消除 \\b 对 ~ 符号的阻断),100% 永久稳定触发
 * 5. Docker / K8s / 进程输出结构化高亮 (表头亮紫、状态健康亮绿/报错红、IP/端口青蓝、镜像Tag粉紫)
 * 6. 100% 前端本地处理,零向远端发送任何字符,零副作用
 */

const textDecoder = new TextDecoder('utf-8');
const textEncoder = new TextEncoder();

const PROMPT_PATTERN = /([a-zA-Z0-9_.-]+)@([a-zA-Z0-9_.-]+):([~a-zA-Z0-9_./-]+)([#$])([ \t]*)/g;
const ACTIVE_LINE_REGEX = /^\s*\[?([a-zA-Z0-9_.-]+)@([a-zA-Z0-9_.-]+)\]?\s*[:\s]\s*\[?([~a-zA-Z0-9_./-]+)\]?\s*[❯#$]\s*(.*)$/;

// 常见 Linux / DevOps 核心命令库 (用于实时输入有效性检查)
const COMMON_COMMANDS = new Set([
  'docker', 'podman', 'kubectl', 'k8s', 'git', 'systemctl', 'journalctl', 'service',
  'npm', 'pnpm', 'yarn', 'npx', 'node', 'python', 'python3', 'pip', 'pip3', 'cargo', 'rustc',
  'go', 'java', 'javac', 'php', 'ruby', 'gcc', 'g++', 'clang', 'make', 'cmake',
  'apt', 'apt-get', 'yum', 'dnf', 'pacman', 'apk', 'brew', 'snap',
  'ls', 'll', 'la', 'cd', 'pwd', 'mkdir', 'rm', 'cp', 'mv', 'touch', 'cat', 'less', 'more',
  'grep', 'egrep', 'fgrep', 'find', 'sed', 'awk', 'diff', 'tar', 'unzip', 'zip', 'gzip',
  'sudo', 'su', 'whoami', 'id', 'chmod', 'chown', 'chgrp', 'ps', 'top', 'htop', 'btop',
  'kill', 'killall', 'pkill', 'free', 'df', 'du', 'uptime', 'uname', 'dmesg', 'iostat',
  'curl', 'wget', 'ssh', 'scp', 'rsync', 'ping', 'netstat', 'ss', 'ip', 'ifconfig',
  'vim', 'vi', 'nano', 'emacs', 'tail', 'head', 'echo', 'printf', 'clear', 'history',
  'export', 'alias', 'source', 'env', 'set', 'sh', 'bash', 'zsh', 'fish', 'which', 'whereis',
  'tree', 'watch', 'xargs', 'tee', 'wc', 'sort', 'uniq', 'cut', 'tr', 'crontab',
  'supervisorctl', 'nginx', 'apache2', 'httpd', 'redis-cli', 'mysql', 'psql',
  'mongo', 'mongosh', 'sqlite3', 'openssl', 'ssh-keygen', 'nc', 'nmap', 'tcpdump', 'traceroute'
]);

/** 对正在输入的命令进行实时语法校验与着色 */
export function highlightCommandLine(cmdText: string): string {
  if (!cmdText) return '';

  const parts = cmdText.match(/([^\s|;&]+|\s+|&&|\|\||[|;&])/g) || [cmdText];
  let isCommandPosition = true;

  return parts.map(part => {
    // 逻辑符/管道符
    if (part === '&&' || part === '||' || part === '|' || part === ';') {
      isCommandPosition = true;
      return `\x1b[38;5;244m${part}\x1b[0m`;
    }
    // 空格
    if (/^\s+$/.test(part)) {
      return part;
    }
    // 参数选项: -a, -la, --all, -p, --name, --port 等
    if (part.startsWith('-')) {
      return `\x1b[38;5;176;1m${part}\x1b[0m`; // 粉紫色参数
    }
    // 引号字符串: "..." 或 '...'
    if ((part.startsWith('"') && part.endsWith('"')) || (part.startsWith("'") && part.endsWith("'"))) {
      return `\x1b[38;5;220m${part}\x1b[0m`; // 金黄色字符串
    }
    // 纯数字或端口
    if (/^\d+$/.test(part)) {
      return `\x1b[38;5;215m${part}\x1b[0m`; // 暖橙色数字
    }

    // 命令位置 (分段首词: 实时检查有效性)
    if (isCommandPosition) {
      isCommandPosition = false;
      const lower = part.toLowerCase();
      // 已知有效命令或路径执行 (./script, /bin/sh, ~/app)
      if (COMMON_COMMANDS.has(lower) || part.startsWith('./') || part.startsWith('/') || part.startsWith('~/')) {
        return `\x1b[38;5;48;1m${part}\x1b[0m`; // 翡翠亮绿 (命令正确)
      }
      // 正在输入中的短词 (1-2字符) 保持正常白色
      if (part.length <= 2) {
        return `\x1b[38;5;252m${part}\x1b[0m`;
      }
      // 拼写错误或未知命令实时标红
      return `\x1b[38;5;203;1m${part}\x1b[0m`; // 珊瑚红 (输入检查未命中)
    }

    // 子命令/动作 (如 ps, status, run, logs, start, build, commit, push)
    if (/^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(part)) {
      return `\x1b[38;5;221;1m${part}\x1b[0m`; // 琥珀黄 (子命令)
    }

    return part;
  }).join('');
}

/** 实时重绘当前光标活动行 (保留完整彩色胶囊 + 实时命令语法高亮) */
export function renderLivePromptLine(lineText: string): string | null {
  const match = lineText.match(ACTIVE_LINE_REGEX);
  if (!match) return null;

  const [, user, host, path, userInput] = match;
  const coloredPrompt = `\x1b[48;5;61;97;1m ${user}@${host} \x1b[0m \x1b[48;5;31;97;1m ${path} \x1b[0m \x1b[38;5;48;1m❯\x1b[0m `;
  const coloredCmd = userInput ? highlightCommandLine(userInput) : '';

  return `\r\x1b[2K${coloredPrompt}${coloredCmd}`;
}

export function beautifyTerminalOutput(chunk: Uint8Array): Uint8Array {
  try {
    const text = textDecoder.decode(chunk);
    let transformed = text;

    // 0. 修复 Linux ls 原生对 777/other-writable 目录添加的刺眼绿色底色块 (Blue/Black on Green BG -> 清晰亮蓝目录)
    transformed = transformed
      .replace(/\x1b\[(?:34;42|42;34|30;42|42;30|0;42|42)m/g, '\x1b[38;5;75;1m')
      .replace(/\x1b\[(?:37;44|44;37)m/g, '\x1b[38;5;75;1m');

    // 1. Linux Prompt 提示符渲染为双色胶囊分段
    if (text.includes('@') && (text.includes(':~') || text.includes(':/') || text.includes(':#') || text.includes(':$'))) {
      PROMPT_PATTERN.lastIndex = 0;
      transformed = transformed.replace(
        PROMPT_PATTERN,
        (_match, user, host, path, _symbol, space) => {
          return `\x1b[48;5;61;97;1m ${user}@${host} \x1b[0m \x1b[48;5;31;97;1m ${path} \x1b[0m \x1b[38;5;48;1m❯\x1b[0m${space || ' '}`;
        }
      );
    }

    // 2. 对紧跟在 ❯ 提示符后面的整条命令做实时语法高亮
    if (transformed.includes('❯')) {
      transformed = transformed.replace(/(❯[ \t]*)([^\r\n]+)/g, (_m, arrow, cmd) => {
        return `${arrow}${highlightCommandLine(cmd)}`;
      });
    }

    // 3. Docker / Linux 进程表头高亮 (CONTAINER ID, IMAGE, STATUS, PORTS, NAMES 等)
    transformed = transformed.replace(
      /\b(CONTAINER ID|IMAGE|COMMAND|CREATED|STATUS|PORTS|NAMES|PID|USER|VIRT|RES|SHR|CPU%|MEM%|TIME\+)\b/g,
      '\x1b[38;5;141;1m$1\x1b[0m'
    );

    // 4. Docker 容器生命周期与健康状态高亮
    transformed = transformed
      .replace(/\b(healthy)\b/g, '\x1b[38;5;48;1mhealthy\x1b[0m')
      .replace(/\b(unhealthy)\b/g, '\x1b[38;5;196;1munhealthy\x1b[0m')
      .replace(/\b(starting)\b/g, '\x1b[38;5;221;1mstarting\x1b[0m')
      .replace(/\b(active \(running\))\b/g, '\x1b[38;5;48;1mactive (running)\x1b[0m')
      .replace(/\b(active \(exited\))\b/g, '\x1b[38;5;220mactive (exited)\x1b[0m')
      .replace(/\b(inactive \(dead\))\b/g, '\x1b[38;5;244minactive (dead)\x1b[0m')
      .replace(/\b(Up [0-9]+ \w+)\b/g, '\x1b[38;5;48;1m$1\x1b[0m')
      .replace(/\b(Exited \([0-9]+\))\b/g, '\x1b[38;5;203;1m$1\x1b[0m')
      .replace(/\b(Restarting \([0-9]+\))\b/g, '\x1b[38;5;220;1m$1\x1b[0m');

    // 5. IP 地址与端口映射高亮 (如 0.0.0.0:8503->8503/tcp, 192.168.1.1, 80/tcp)
    transformed = transformed
      .replace(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?(?:\->\d+\/\w+)?)\b/g, '\x1b[38;5;81m$1\x1b[0m')
      .replace(/\b(:::\d+(?:\->\d+\/\w+)?)\b/g, '\x1b[38;5;81m$1\x1b[0m')
      .replace(/\b(\d+\/(?:tcp|udp))\b/g, '\x1b[38;5;111m$1\x1b[0m');

    // 6. 日志级别与状态关键词高亮
    transformed = transformed
      .replace(/\[(INFO|NOTICE)\]/g, '[\x1b[38;5;75;1m$1\x1b[0m]')
      .replace(/\[(WARN|WARNING)\]/g, '[\x1b[38;5;220;1m$1\x1b[0m]')
      .replace(/\[(ERROR|FAIL|FAILED|FATAL|CRITICAL)\]/g, '[\x1b[38;5;196;1m$1\x1b[0m]')
      .replace(/\[(SUCCESS|OK|DONE)\]/g, '[\x1b[38;5;48;1m$1\x1b[0m]')
      .replace(/\[(DEBUG|TRACE)\]/g, '[\x1b[38;5;244m$1\x1b[0m]')
      .replace(/\b(ERROR|FATAL|FAILED|Exception)\b/g, '\x1b[38;5;196;1m$1\x1b[0m')
      .replace(/\b(SUCCESS|SUCCESSFUL|PASSED)\b/g, '\x1b[38;5;48;1m$1\x1b[0m');

    // 7. 镜像 tag 高亮 (如 redis:7-alpine, postgres:15)
    transformed = transformed.replace(
      /:([0-9]+[a-zA-Z0-9_.-]*|latest|alpine|bullseye|bookworm)\b/g,
      ':\x1b[38;5;176m$1\x1b[0m'
    );

    return textEncoder.encode(transformed);
  } catch {
    return chunk;
  }
}
