import { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

interface LayoutProps {
  children: ReactNode;
  currentPage: string;
  onNavigate: (page: string) => void;
  title: string;
  onLogout?: () => void;
}

export function Layout({ children, currentPage, onNavigate, title, onLogout }: LayoutProps) {
  return (
    <div className="h-screen overflow-hidden bg-slate-950 light:bg-slate-50 flex">
      <Sidebar currentPage={currentPage} onNavigate={onNavigate} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title={title} onLogout={onLogout} />
        <main className="flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}

export { Sidebar } from './Sidebar';
export { Header } from './Header';
