import { useEffect, ReactNode, memo } from 'react';
import { CheckCircle2, XCircle, AlertCircle, X } from 'lucide-react';
import { useUIStore, type Toast, type ToastType } from '../../store/useUIStore';

// Re-export for backward compatibility
export { useToast } from '../../store/useUIStore';
export type { ToastType };

const icons = {
  success: CheckCircle2,
  error: XCircle,
  info: AlertCircle,
};

const colors = {
  success: 'bg-emerald-500/10 light:bg-emerald-50 border-emerald-500/30 light:border-emerald-300 text-emerald-400 light:text-emerald-700',
  error: 'bg-rose-500/10 light:bg-rose-50 border-rose-500/30 light:border-rose-300 text-rose-400 light:text-rose-700',
  info: 'bg-cyan-500/10 light:bg-cyan-50 border-cyan-500/30 light:border-cyan-300 text-cyan-400 light:text-cyan-700',
};

const ToastItem = memo(function ToastItem({
  toast,
  onRemove
}: {
  toast: Toast;
  onRemove: () => void;
}) {
  const Icon = icons[toast.type];

  useEffect(() => {
    const timer = setTimeout(onRemove, 3000);
    return () => clearTimeout(timer);
  }, [onRemove]);

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-lg border backdrop-blur-sm shadow-lg animate-slide-in ${colors[toast.type]}`}
    >
      <Icon className="w-5 h-5 flex-shrink-0" />
      <p className="text-sm flex-1">{toast.message}</p>
      <button
        onClick={onRemove}
        className="p-1 hover:bg-white/10 rounded transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
});

// Toast container component - renders toasts from store
function ToastContainer() {
  const toasts = useUIStore(state => state.toasts);
  const removeToast = useUIStore(state => state.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 min-w-80">
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onRemove={() => removeToast(toast.id)}
        />
      ))}
    </div>
  );
}

// ToastProvider - now just renders children and ToastContainer
// Keeping for backward compatibility
export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <ToastContainer />
    </>
  );
}
