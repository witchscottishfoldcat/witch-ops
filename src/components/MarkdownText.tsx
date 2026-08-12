import React from 'react';

/**
 * Lightweight Markdown renderer (zero deps)
 *
 * Supports: code blocks, inline code, bold, headers,
 * unordered/ordered lists, hr, paragraphs.
 */

/** 渲染行内格式(粗体 + 行内代码) */
function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // 正则匹配 **bold** 或 `code`
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      nodes.push(text.slice(lastIdx, match.index));
    }
    const token = match[0];
    if (token.startsWith('**')) {
      nodes.push(<strong key={`${keyBase}-b-${i}`} style={{ fontWeight: 700 }}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      nodes.push(
        <code key={`${keyBase}-c-${i}`} style={{
          background: 'rgba(100, 210, 255, 0.12)', color: 'var(--accent-cyan)',
          padding: '1px 5px', borderRadius: 3, fontSize: '0.9em',
          fontFamily: 'var(--font-mono)',
        }}>
          {token.slice(1, -1)}
        </code>
      );
    }
    lastIdx = regex.lastIndex;
    i++;
  }
  if (lastIdx < text.length) nodes.push(text.slice(lastIdx));
  return nodes;
}

export const MarkdownText: React.FC<{ content: string; fontSize?: number }> = ({ content, fontSize = 13 }) => {
  const lines = content.split('\n');
  const blocks: React.ReactNode[] = [];
  let codeBlock: string[] | null = null;
  let codeLang = '';
  let listItems: React.ReactNode[] = [];
  let listOrdered = false;

  const flushList = () => {
    if (listItems.length === 0) return;
    const Tag = listOrdered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={`list-${blocks.length}`} style={{
        margin: '4px 0', paddingLeft: 20,
        fontSize, lineHeight: 1.6, color: 'var(--text-main)',
      }}>
        {listItems}
      </Tag>
    );
    listItems = [];
    listOrdered = false;
  };

  lines.forEach((line, idx) => {
    // 代码块边界
    if (line.trim().startsWith('```')) {
      if (codeBlock) {
        // 结束代码块
        blocks.push(
          <pre key={`code-${blocks.length}`} style={{
            background: 'rgba(0, 0, 0, 0.45)', border: '1px solid var(--border-color)',
            borderRadius: 6, padding: '10px 12px', margin: '6px 0',
            overflowX: 'auto', fontFamily: 'var(--font-mono)',
            fontSize: fontSize - 1, lineHeight: 1.5,
          }}>
            {codeLang && (
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>{codeLang}</div>
            )}
            <code style={{ color: 'var(--accent-cyan)' }}>{codeBlock.join('\n')}</code>
          </pre>
        );
        codeBlock = null;
        codeLang = '';
      } else {
        // 开始代码块
        flushList();
        codeBlock = [];
        codeLang = line.trim().slice(3).trim();
      }
      return;
    }

    if (codeBlock) {
      codeBlock.push(line);
      return;
    }

    // 空行:刷新列表
    if (line.trim() === '') {
      flushList();
      return;
    }

    // 标题
    const headerMatch = line.match(/^(#{1,3})\s+(.*)/);
    if (headerMatch) {
      flushList();
      const level = headerMatch[1].length;
      const size = level === 1 ? fontSize + 4 : level === 2 ? fontSize + 2 : fontSize + 1;
      blocks.push(
        <div key={`h-${blocks.length}`} style={{
          fontSize: size, fontWeight: 700, margin: '8px 0 4px',
          color: 'var(--text-main)',
        }}>
          {renderInline(headerMatch[2], `h-${blocks.length}`)}
        </div>
      );
      return;
    }

    // 分隔线
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushList();
      blocks.push(<hr key={`hr-${blocks.length}`} style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '8px 0' }} />);
      return;
    }

    // 无序列表
    if (/^\s*[-*•]\s+/.test(line)) {
      listOrdered = false;
      const text = line.replace(/^\s*[-*•]\s+/, '');
      listItems.push(
        <li key={`li-${blocks.length}-${idx}`}>{renderInline(text, `li-${idx}`)}</li>
      );
      return;
    }

    // 有序列表
    const olMatch = line.match(/^\s*(\d+)\.\s+(.*)/);
    if (olMatch) {
      listOrdered = true;
      listItems.push(
        <li key={`li-${blocks.length}-${idx}`}>{renderInline(olMatch[2], `li-${idx}`)}</li>
      );
      return;
    }

    // 普通段落
    flushList();
    blocks.push(
      <p key={`p-${blocks.length}`} style={{
        margin: '2px 0', fontSize, lineHeight: 1.6, color: 'var(--text-main)',
      }}>
        {renderInline(line, `p-${blocks.length}`)}
      </p>
    );
  });

  // 收尾:未关闭的代码块 / 列表
  const trailingCode: string[] | null = codeBlock as string[] | null;
  if (trailingCode) {
    blocks.push(
      <pre key={`code-end`} style={{
        background: 'rgba(0, 0, 0, 0.45)', border: '1px solid var(--border-color)',
        borderRadius: 6, padding: '10px 12px', margin: '6px 0',
        overflowX: 'auto', fontFamily: 'var(--font-mono)',
        fontSize: fontSize - 1, lineHeight: 1.5,
      }}>
        <code style={{ color: 'var(--accent-cyan)' }}>{trailingCode.join('\n')}</code>
      </pre>
    );
  }
  flushList();

  return <div>{blocks}</div>;
};
