import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Check, ExternalLink, Database } from 'lucide-react';
import { Button } from '../ui';
import { SUPABASE_INIT_SQL } from '../../lib/database/supabase-init-sql';

interface SupabaseInitModalProps {
  isOpen: boolean;
  onClose: () => void;
  supabaseUrl: string;
}

export function SupabaseInitModal({ isOpen, onClose, supabaseUrl }: SupabaseInitModalProps) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(SUPABASE_INIT_SQL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // 从 URL 中提取项目 ID 并构建 SQL Editor 链接
  const getSqlEditorUrl = () => {
    if (!supabaseUrl) return 'https://supabase.com/dashboard';
    const match = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/);
    if (match) {
      return `https://supabase.com/dashboard/project/${match[1]}/sql/new`;
    }
    return 'https://supabase.com/dashboard';
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 light:bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700 light:border-slate-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-cyan-500/10 light:bg-cyan-100 rounded-lg">
              <Database className="w-5 h-5 text-cyan-500 light:text-cyan-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-200 light:text-slate-800">
                初始化 Supabase 数据库
              </h2>
              <p className="text-sm text-slate-500 light:text-slate-600">
                请按照以下步骤创建表结构
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-700 light:hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-slate-400 light:text-slate-500" />
          </button>
        </div>

        {/* Steps */}
        <div className="p-4 border-b border-slate-700 light:border-slate-200 space-y-3">
          <div className="flex items-start gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-500 text-white text-sm font-medium flex items-center justify-center">
              1
            </span>
            <div>
              <p className="text-sm font-medium text-slate-200 light:text-slate-800">
                点击下方按钮复制 SQL 脚本
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-500 text-white text-sm font-medium flex items-center justify-center">
              2
            </span>
            <div>
              <p className="text-sm font-medium text-slate-200 light:text-slate-800">
                打开 Supabase Dashboard 的 SQL Editor
              </p>
              <a
                href={getSqlEditorUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-cyan-500 hover:underline mt-1"
              >
                打开 SQL Editor
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-500 text-white text-sm font-medium flex items-center justify-center">
              3
            </span>
            <div>
              <p className="text-sm font-medium text-slate-200 light:text-slate-800">
                粘贴 SQL 脚本并点击 "Run" 执行
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-500 text-white text-sm font-medium flex items-center justify-center">
              4
            </span>
            <div>
              <p className="text-sm font-medium text-slate-200 light:text-slate-800">
                返回此页面，点击"测试连接"验证
              </p>
            </div>
          </div>
        </div>

        {/* SQL Preview */}
        <div className="p-4 flex-shrink min-h-0 overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-slate-400 light:text-slate-600">
              SQL 脚本预览
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleCopy}
              className="gap-2"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-emerald-500" />
                  <span>已复制</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>复制 SQL</span>
                </>
              )}
            </Button>
          </div>
          <pre className="max-h-72 overflow-auto bg-slate-900 light:bg-slate-100 rounded-lg p-4 text-xs text-slate-300 light:text-slate-700 font-mono whitespace-pre-wrap break-all">
            {SUPABASE_INIT_SQL}
          </pre>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-700 light:border-slate-200 flex items-center justify-between">
          <div className="text-xs text-slate-500 light:text-slate-600">
            此脚本会创建 11 个表和相应的索引、策略
          </div>
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={onClose}>
              关闭
            </Button>
            <Button onClick={handleCopy}>
              {copied ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>已复制</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>复制 SQL</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
