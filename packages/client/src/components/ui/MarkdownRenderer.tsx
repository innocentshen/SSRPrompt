import { useMemo } from 'react';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

function parseTable(tableText: string): string {
  const lines = tableText.trim().split('\n');
  if (lines.length < 2) return tableText;

  // Simpler and more robust cell parsing
  const parseRow = (line: string): string[] => {
    // Remove leading and trailing pipes, then split by |
    const trimmed = line.replace(/^\||\|$/g, '');
    return trimmed.split('|').map((cell) => cell.trim());
  };

  const headerCells = parseRow(lines[0]);
  if (headerCells.length === 0) return tableText;

  const separatorLine = lines[1];
  if (!separatorLine.match(/^[\s|:-]+$/)) return tableText;

  let html = '<div class="overflow-x-auto my-3"><table class="min-w-full border-collapse text-sm">';
  html += '<thead><tr class="bg-slate-800 light:bg-slate-100 border-b border-slate-600 light:border-slate-300">';
  headerCells.forEach((cell) => {
    html += `<th class="px-3 py-2 text-left text-xs font-semibold text-slate-300 light:text-slate-700 uppercase tracking-wider border border-slate-600 light:border-slate-300 whitespace-nowrap">${cell}</th>`;
  });
  html += '</tr></thead><tbody>';

  for (let i = 2; i < lines.length; i++) {
    const cells = parseRow(lines[i]);
    if (cells.length === 0) continue;
    const rowClass = i % 2 === 0 ? 'bg-slate-800/30 light:bg-white' : 'bg-slate-800/50 light:bg-slate-50';
    html += `<tr class="${rowClass}">`;
    for (let j = 0; j < headerCells.length; j++) {
      html += `<td class="px-3 py-2 text-slate-300 light:text-slate-700 border border-slate-700 light:border-slate-300">${cells[j] || ''}</td>`;
    }
    html += '</tr>';
  }

  html += '</tbody></table></div>';
  return html;
}

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  const html = useMemo(() => {
    let result = content;

    result = result.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    result = result.replace(/```(\w*)\n([\s\S]*?)```/g, (_, _lang, code) => {
      return `<pre class="bg-slate-900 border border-slate-700 rounded-lg p-3 my-2 overflow-x-auto"><code class="text-sm text-slate-300 font-mono">${code.trim()}</code></pre>`;
    });

    const tableRegex = /^(\|[^\n]+\|\n\|[-:\s|]+\|\n(?:\|[^\n]+\|\n?)*)/gm;
    result = result.replace(tableRegex, (match) => parseTable(match));

    result = result.replace(/`([^`]+)`/g, '<code class="bg-slate-700 px-1.5 py-0.5 rounded text-cyan-400 text-sm font-mono">$1</code>');

    result = result.replace(/^### (.*$)/gm, '<h3 class="text-base font-semibold text-white mt-4 mb-2">$1</h3>');
    result = result.replace(/^## (.*$)/gm, '<h2 class="text-lg font-semibold text-white mt-4 mb-2">$1</h2>');
    result = result.replace(/^# (.*$)/gm, '<h1 class="text-xl font-bold text-white mt-4 mb-2">$1</h1>');

    result = result.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-white">$1</strong>');
    result = result.replace(/\*([^*]+)\*/g, '<em class="italic">$1</em>');

    result = result.replace(/^\s*[-*]\s+(.*)$/gm, '<li class="ml-4 list-disc text-slate-300">$1</li>');
    result = result.replace(/(<li[^>]*>.*<\/li>\n?)+/g, '<ul class="my-2 space-y-1">$&</ul>');

    result = result.replace(/^\s*(\d+)\.\s+(.*)$/gm, '<li class="ml-4 list-decimal text-slate-300">$2</li>');

    result = result.replace(/^---$/gm, '<hr class="border-slate-700 my-4" />');

    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-cyan-400 hover:text-cyan-300 underline">$1</a>');

    result = result.replace(/^(?!<[huplo]|<li|<pre|<hr|<div|<table)(.+)$/gm, (match, text) => {
      if (text.trim()) {
        return `<p class="text-slate-300 my-1">${text}</p>`;
      }
      return match;
    });

    return result;
  }, [content]);

  return (
    <div
      className={`markdown-content ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}