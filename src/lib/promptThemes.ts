/**
 * 0 侵入纯会话级 Linux 终端美化引擎
 *
 * 特性:
 * - 纯前端渲染与内存级 Shell 环境变量配置
 * - 不向服务器下载任何文件,不写入任何磁盘数据
 * - 会话关闭后远端服务器 0 残留
 */

export interface PromptPreset {
  id: string;
  name: string;
  desc: string;
  preview: string;
  script: string;
}

export const PROMPT_PRESETS: PromptPreset[] = [
  {
    id: 'starship-pill',
    name: '🚀 Starship 胶囊药丸 (推荐)',
    desc: '开源 Starship 风格多色分段提示符,无方块乱码,纯净高对比度',
    preview: ' [root@host] [~] ❯ ',
    script: "export TERM=xterm-256color COLORTERM=truecolor CLICOLOR=1 FORCE_COLOR=1 && export PS1='\\[\\e[48;5;61;97;1m\\] \\u@\\h \\[\\e[0m\\] \\[\\e[48;5;31;97;1m\\] \\w \\[\\e[0m\\] \\[\\e[38;5;48;1m\\]❯\\[\\e[0m\\] ' && alias ls='ls --color=auto' ll='ls -lah --color=auto' la='ls -A --color=auto' grep='grep --color=auto' diff='diff --color=auto' ip='ip -color=auto' 2>/dev/null",
  },
  {
    id: 'rainbow-cyber',
    name: '🌈 Cyberpunk 霓虹双行 (Kali 风格)',
    desc: '开源 Kali / Oh-My-Bash 双行极客风格,路径与输入区分离',
    preview: '┌──[ root@host ]─[ ~ ]\n└──╼ ⚡ ',
    script: "export TERM=xterm-256color COLORTERM=truecolor CLICOLOR=1 FORCE_COLOR=1 && export PS1='\\[\\e[38;5;244m\\]┌──[\\[\\e[38;5;141;1m\\]\\u@\\h\\[\\e[38;5;244m\\]]─[\\[\\e[38;5;75;1m\\]\\w\\[\\e[38;5;244m\\]]\\n\\[\\e[38;5;244m\\]└──╼ \\[\\e[38;5;48;1m\\]⚡\\[\\e[0m\\] ' && alias ls='ls --color=auto' ll='ls -lah --color=auto' grep='grep --color=auto' 2>/dev/null",
  },
  {
    id: 'minimal-gradient',
    name: '⚡ Minimalist 极简高亮',
    desc: '单行现代渐变 (绿色用户 + 紫色主机 + 蓝色路径 + 黄金箭头)',
    preview: 'root@host:~/path ❯ ',
    script: "export TERM=xterm-256color COLORTERM=truecolor CLICOLOR=1 FORCE_COLOR=1 && export PS1='\\[\\e[38;5;48;1m\\]\\u\\[\\e[38;5;245m\\]@\\[\\e[38;5;141;1m\\]\\h\\[\\e[0m\\]:\\[\\e[38;5;75;1m\\]\\w\\[\\e[0m\\] \\[\\e[38;5;220;1m\\]❯\\[\\e[0m\\] ' && alias ls='ls --color=auto' ll='ls -lah --color=auto' grep='grep --color=auto' 2>/dev/null",
  },
  {
    id: 'classic-color',
    name: '🍀 Linux 经典原生高亮',
    desc: '标准 Linux 发行版原生高亮 (绿色主机 + 蓝色路径)',
    preview: 'root@host:~# ',
    script: "export TERM=xterm-256color COLORTERM=truecolor CLICOLOR=1 FORCE_COLOR=1 && export PS1='\\[\\e[01;32m\\]\\u@\\h\\[\\e[00m\\]:\\[\\e[01;34m\\]\\w\\[\\e[00m\\]\\$ ' && alias ls='ls --color=auto' ll='ls -la --color=auto' grep='grep --color=auto' 2>/dev/null",
  },
];
