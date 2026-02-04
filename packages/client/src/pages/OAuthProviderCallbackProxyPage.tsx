import { useEffect, useMemo } from 'react';
import { useLocation, useParams, Link } from 'react-router-dom';
import { AlertCircle, ExternalLink, Lock } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';
const KNOWN_PROVIDERS = new Set(['google', 'linuxdo']);

export function OAuthProviderCallbackProxyPage() {
  const location = useLocation();
  const params = useParams();
  const provider = params.provider;

  const targetUrl = useMemo(() => {
    if (!provider || !KNOWN_PROVIDERS.has(provider)) return null;
    return `${API_BASE_URL}/auth/oauth/${provider}/callback${location.search || ''}`;
  }, [location.search, provider]);

  useEffect(() => {
    if (!targetUrl) return;
    window.location.replace(targetUrl);
  }, [targetUrl]);

  const title = targetUrl ? '正在跳转...' : 'OAuth 回调无效';
  const description = targetUrl
    ? '正在将 OAuth 回调转发到 API 服务器完成登录…'
    : '当前 URL 中的 OAuth provider 不受支持。';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-xl p-8 shadow-2xl">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-cyan-500/10 rounded-2xl mb-4">
            <Lock className="w-8 h-8 text-cyan-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-1">SSRPrompt</h1>
          <p className="text-slate-400">{title}</p>
        </div>

        {targetUrl ? (
          <div className="text-center text-slate-300">
            <div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            {description}
            <div className="mt-4">
              <a
                className="inline-flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300"
                href={targetUrl}
                rel="noreferrer"
              >
                <ExternalLink className="w-4 h-4" />
                如果未自动跳转，点这里继续
              </a>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 bg-rose-950/30 border border-rose-900/50 rounded-lg">
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
              <p className="text-sm text-rose-300">{description}</p>
            </div>
            <Link
              className="inline-flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300"
              to="/login"
              replace
            >
              返回登录页
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default OAuthProviderCallbackProxyPage;

