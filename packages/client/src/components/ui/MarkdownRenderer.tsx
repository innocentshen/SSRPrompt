import { isValidElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { HtmlArtifactsCard } from './HtmlArtifactsCard';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  isStreaming?: boolean;
}

function isProbablyHtmlDocument(text: string): boolean {
  const v = text.trimStart().slice(0, 512).toLowerCase();
  if (v.startsWith('<!doctype html') || v.startsWith('<html')) return true;
  if (v.includes('<html') && v.includes('</html>')) return true;
  return false;
}

function CodeBlockView({ language, code }: { language: string | null; code: string }) {
  const label = `<${(language || 'code').toUpperCase()}>`;
  const isText = language === 'text';

  return (
    <div className="my-2 border border-slate-700 light:border-slate-200 rounded-lg overflow-hidden bg-slate-950/60 light:bg-slate-50">
      <div className="px-3 py-1.5 border-b border-slate-800 light:border-slate-200 text-[11px] uppercase tracking-wider text-slate-500 light:text-slate-600">
        {label}
      </div>
      <pre
        className={
          isText
            ? 'p-3 overflow-x-auto text-xs text-slate-200 light:text-slate-800 font-mono whitespace-pre-wrap break-words'
            : 'p-3 overflow-x-auto text-xs text-slate-200 light:text-slate-800 font-mono whitespace-pre'
        }
      >
        {code}
      </pre>
    </div>
  );
}

export function MarkdownRenderer({ content, className = '', isStreaming = false }: MarkdownRendererProps) {
  if (isProbablyHtmlDocument(content) && !content.includes('```')) {
    return <HtmlArtifactsCard html={content} isStreaming={isStreaming} />;
  }

  return (
    <div className={`markdown-content ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => {
            if (!isValidElement(children)) {
              return (
                <pre className="my-2 p-3 overflow-x-auto bg-slate-950/60 light:bg-slate-50 border border-slate-700 light:border-slate-200 rounded-lg text-xs text-slate-200 light:text-slate-800 font-mono whitespace-pre">
                  {children}
                </pre>
              );
            }

            const codeElement = children;
            const props = codeElement.props as { className?: string; children?: unknown };
            const codeClassName = String(props.className || '');
            const raw = String(props.children ?? '');
            const code = raw.replace(/\n$/, '');
            const match = /language-([\w-+]+)/.exec(codeClassName);
            const fenceLanguage = match?.[1]?.toLowerCase() ?? null;
            const displayLanguage = fenceLanguage ?? (code.includes('\n') ? 'text' : null);

            if (fenceLanguage === 'html' || (fenceLanguage === null && isProbablyHtmlDocument(code))) {
              return <HtmlArtifactsCard html={code} isStreaming={isStreaming} />;
            }

            if (fenceLanguage === 'markdown' || fenceLanguage === 'md') {
              return <MarkdownRenderer content={code} isStreaming={isStreaming} />;
            }

            return <CodeBlockView language={displayLanguage} code={code} />;
          },
          h1: ({ children }) => (
            <h1 className="text-xl font-bold text-white light:text-slate-900 mt-4 mb-2">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-lg font-semibold text-white light:text-slate-900 mt-4 mb-2">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-base font-semibold text-white light:text-slate-900 mt-3 mb-2">{children}</h3>
          ),
          p: ({ children }) => (
            <p className="text-slate-300 light:text-slate-700 my-1 leading-relaxed">{children}</p>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 hover:text-cyan-300 light:text-cyan-700 light:hover:text-cyan-800 underline"
            >
              {children}
            </a>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-white light:text-slate-900">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => <ul className="my-2 space-y-1 list-disc pl-6">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 space-y-1 list-decimal pl-6">{children}</ol>,
          li: ({ children }) => <li className="text-slate-300 light:text-slate-700">{children}</li>,
          hr: () => <hr className="border-slate-700 light:border-slate-200 my-4" />,
          table: ({ children }) => (
            <div className="overflow-x-auto my-3">
              <table className="min-w-full border-collapse text-sm border border-slate-700 light:border-slate-200">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-slate-800 light:bg-slate-100 border-b border-slate-700 light:border-slate-200">
              {children}
            </thead>
          ),
          th: ({ children }) => (
            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-200 light:text-slate-700 uppercase tracking-wider border border-slate-700 light:border-slate-200 whitespace-nowrap">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-slate-300 light:text-slate-700 border border-slate-700 light:border-slate-200 align-top">
              {children}
            </td>
          ),
          code: ({ className, children, ...props }) => {
            const hasLanguage = Boolean(className && String(className).includes('language-'));
            if (hasLanguage) {
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            }

            return (
              <code
                {...props}
                className="bg-slate-800 light:bg-slate-200 px-1.5 py-0.5 rounded text-cyan-300 light:text-cyan-700 text-[0.95em] font-mono"
              >
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
