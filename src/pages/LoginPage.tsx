import { useState } from 'react';
import { Lock, AlertCircle, Github, Star } from 'lucide-react';
import { Button, Input } from '../components/ui';

interface LoginPageProps {
  onLogin: (password: string) => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    setTimeout(() => {
      if (password === import.meta.env.VITE_APP_PASSWORD) {
        onLogin(password);
      } else {
        setError('密码错误，请重试');
        setPassword('');
      }
      setIsLoading(false);
    }, 300);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      {/* GitHub Link - Top Right */}
      <a
        href="https://github.com/innocentshen/ssrprompt"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed top-6 right-6 flex items-center gap-2 px-4 py-2 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-600 rounded-lg transition-all duration-200 hover:scale-105 group backdrop-blur-sm"
        title="Star on GitHub"
      >
        <Github className="w-5 h-5 text-slate-300 group-hover:text-white" />
        <span className="text-sm font-medium text-slate-300 group-hover:text-white hidden sm:inline">
          Star on GitHub
        </span>
        <Star className="w-4 h-4 text-yellow-400 group-hover:text-yellow-300" />
      </a>

      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-cyan-500/10 rounded-2xl mb-4">
            <Lock className="w-8 h-8 text-cyan-400" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">SSRPrompt</h1>
          <p className="text-slate-400">请输入密码以访问系统</p>
        </div>

        <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-xl p-8 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-2">
                访问密码
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="输入密码"
                className="w-full"
                autoFocus
                disabled={isLoading}
              />
              <p className="mt-2 text-xs text-slate-500">
                默认密码为 admin123，可在环境变量 VITE_APP_PASSWORD 中修改
              </p>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-rose-950/30 border border-rose-900/50 rounded-lg">
                <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                <p className="text-sm text-rose-300">{error}</p>
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={!password || isLoading}
            >
              {isLoading ? '验证中...' : '进入系统'}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-500 mt-6">
          请妥善保管您的访问密码
        </p>

        {/* GitHub Link - Bottom */}
        <div className="mt-6 text-center">
          <a
            href="https://github.com/innocentshen/ssrprompt"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-cyan-400 transition-colors duration-200"
          >
            <Github className="w-4 h-4" />
            <span>如果觉得不错，请给我一个 Star</span>
            <Star className="w-4 h-4 text-yellow-500" />
          </a>
        </div>
      </div>
    </div>
  );
}
