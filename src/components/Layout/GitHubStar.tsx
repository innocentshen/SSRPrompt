import { useState, useEffect } from 'react';
import { Star } from 'lucide-react';

// GitHub 仓库配置
const GITHUB_REPO = 'innocentshen/ssrprompt';

interface GitHubStarProps {
  repo?: string;
}

export function GitHubStar({ repo = GITHUB_REPO }: GitHubStarProps) {
  const [starCount, setStarCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStarCount = async () => {
      try {
        // 先尝试从 localStorage 获取缓存
        const cacheKey = `github_stars_${repo}`;
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const { count, timestamp } = JSON.parse(cached);
          // 缓存 10 分钟
          if (Date.now() - timestamp < 10 * 60 * 1000) {
            setStarCount(count);
            setLoading(false);
            return;
          }
        }

        const response = await fetch(`https://api.github.com/repos/${repo}`);
        if (response.ok) {
          const data = await response.json();
          const count = data.stargazers_count;
          setStarCount(count);
          // 缓存结果
          localStorage.setItem(cacheKey, JSON.stringify({ count, timestamp: Date.now() }));
        }
      } catch (error) {
        console.error('Failed to fetch GitHub stars:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStarCount();
  }, [repo]);

  const formatCount = (count: number): string => {
    if (count >= 1000) {
      return (count / 1000).toFixed(1) + 'k';
    }
    return count.toString();
  };

  return (
    <a
      href={`https://github.com/${repo}`}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-slate-400 dark:text-slate-400 light:text-slate-500 hover:text-white dark:hover:text-white light:hover:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-800 light:hover:bg-slate-200 rounded-lg transition-colors"
      title="Star on GitHub"
    >
      <svg
        viewBox="0 0 16 16"
        className="w-4 h-4"
        fill="currentColor"
      >
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
      </svg>
      <Star className="w-3.5 h-3.5" />
      {loading ? (
        <span className="text-xs">...</span>
      ) : starCount !== null ? (
        <span className="text-xs font-medium">{formatCount(starCount)}</span>
      ) : null}
    </a>
  );
}
