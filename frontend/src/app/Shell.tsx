import React, { useState, useEffect, useRef } from 'react';
import { useAuthStore, formatRoleLabel } from './authStore';
import { useWebSocket } from '../api/ws';
import {
  Server,
  LayoutDashboard,
  TrendingUp,
  CheckSquare,
  FileText,
  ShieldCheck,
  Search,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Radio,
  RefreshCw,
  Clock,
  Zap,
  X,
} from 'lucide-react';

export type NavSection =
  | 'overview'
  | 'racks'
  | 'forecasts'
  | 'approvals'
  | 'audit'
  | 'access';

export interface ShellProps {
  currentSection: NavSection;
  onNavigate: (section: NavSection) => void;
  pageTitle: string;
  breadcrumb?: string[];
  children: React.ReactNode;
}

export const Shell: React.FC<ShellProps> = ({
  currentSection,
  onNavigate,
  pageTitle,
  breadcrumb,
  children,
}) => {
  const { user, logout } = useAuthStore();
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Single WebSocket connection state
  const { status, reconnectAttempt, tickAge, onChangepoint } = useWebSocket();

  // Changepoint notification toast state
  const [changepointToast, setChangepointToast] = useState<{
    fact?: string;
    shift: string;
    ts: string;
  } | null>(null);

  // Persistent timer ref with unmount cleanup
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsub = onChangepoint((cp) => {
      let fact: string | undefined;
      if (cp.topology_event) {
        fact = `Node ${cp.topology_event.node_id} came ${
          cp.topology_event.type === 'node_online' ? 'online' : 'offline'
        }.`;
      }
      const shift = `Regime change on ${cp.node_id} (${cp.metric}) — forecast window reset.`;
      setChangepointToast({ fact, shift, ts: new Date().toLocaleTimeString() });

      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
      toastTimerRef.current = setTimeout(() => {
        setChangepointToast(null);
        toastTimerRef.current = null;
      }, 7000);
    });

    return () => {
      unsub();
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, [onChangepoint]);

  const isSuperUser = user?.role === 'SUPER_USER';
  const roleLabel = user?.role ? formatRoleLabel(user.role) : '';

  const navItems = [
    { id: 'overview' as NavSection, label: 'Overview', icon: LayoutDashboard },
    { id: 'racks' as NavSection, label: 'Racks', icon: Server },
    { id: 'forecasts' as NavSection, label: 'Forecasts', icon: TrendingUp },
    { id: 'approvals' as NavSection, label: 'Approvals', icon: CheckSquare },
    { id: 'audit' as NavSection, label: 'Audit Log', icon: FileText },
    ...(isSuperUser
      ? [{ id: 'access' as NavSection, label: 'Access Control', icon: ShieldCheck }]
      : []),
  ];

  return (
    <div className="min-h-screen bg-canvas flex flex-col">
      {/* 1. App Bar (56px, --surface, 1px bottom border) */}
      <header className="h-14 bg-surface border-b border-border sticky top-0 z-30 px-4 flex items-center justify-between">
        {/* Left: Brand & Page Title */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 font-semibold text-ink text-14">
            <div className="w-7 h-7 rounded bg-primary-weak text-primary flex items-center justify-center">
              <Server size={16} strokeWidth={1.5} />
            </div>
            <span className="tracking-tight">RackSense</span>
          </div>

          <div className="hidden md:block h-4 w-px bg-border" />

          <h1 className="hidden sm:inline-block font-semibold text-14 text-ink">
            {pageTitle}
          </h1>
        </div>

        {/* Center: Global Search */}
        <div className="flex-1 max-w-md mx-4 hidden lg:block">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search racks, slots, tenants, proposals..."
              disabled
              title="Global search across entities is disabled; use page-level filters."
              className="w-full h-8 pl-8 pr-3 text-12 rounded border border-border bg-surface-sunken text-ink placeholder:text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Global search"
            />
            <Search
              size={14}
              strokeWidth={1.5}
              className="absolute left-2.5 top-2 text-ink-muted pointer-events-none"
              aria-hidden="true"
            />
          </div>
        </div>

        {/* Right: Connection Indicator & User Menu */}
        <div className="flex items-center gap-4">
          {/* Connection Status Indicator per phase-3-realtime.md §3 */}
          {status === 'connected' ? (
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-ok-weak border border-ok/30 text-ok text-11 font-medium tabular-nums font-mono"
              title="Telemetry and WebSocket connection live"
            >
              <Radio size={12} strokeWidth={2} className="animate-pulse" />
              <span>Live · {tickAge}s</span>
            </div>
          ) : status === 'reconnecting' ? (
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-warning-weak/60 border border-warning/40 text-ink text-11 font-medium tabular-nums font-mono"
              title={`Connection lost. Reconnect attempt ${reconnectAttempt}`}
            >
              <RefreshCw size={12} strokeWidth={2} className="animate-spin text-warning" />
              <span>Reconnecting… ({reconnectAttempt})</span>
            </div>
          ) : (
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-sunken border border-border text-ink-muted text-11 font-medium tabular-nums font-mono"
              title="No frame received for > 10 s. Data is stale."
            >
              <Clock size={12} strokeWidth={1.5} />
              <span>Last update {tickAge} s ago</span>
            </div>
          )}

          {/* User & Role Badge */}
          <div className="flex items-center gap-3 pl-3 border-l border-border">
            <div className="text-right hidden sm:block">
              <div className="text-13 font-medium text-ink leading-none">
                {user?.display_name || 'Console User'}
              </div>
              <div className="text-11 text-ink-2 mt-0.5 leading-none">
                {roleLabel}
              </div>
            </div>

            <button
              type="button"
              onClick={logout}
              className="p-1.5 rounded text-ink-2 hover:text-ink hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              title="Sign Out"
              aria-label="Sign out of console"
            >
              <LogOut size={16} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Layout Container */}
      <div className="flex-1 flex">
        {/* 2. Left Nav (256px collapsible to 56px) */}
        <nav
          className={`bg-surface border-r border-border shrink-0 transition-all duration-150 flex flex-col justify-between ${
            navCollapsed ? 'w-14' : 'w-64'
          }`}
          aria-label="Sidebar navigation"
        >
          <div className="py-3 px-2 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentSection === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded text-13 transition-colors text-left relative ${
                    isActive
                      ? 'bg-primary-weak text-primary font-medium'
                      : 'text-ink-2 hover:text-ink hover:bg-surface-hover'
                  }`}
                  title={navCollapsed ? item.label : undefined}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {/* 3px active left indicator rule */}
                  {isActive && (
                    <div className="absolute left-0 top-1 bottom-1 w-[3px] bg-primary rounded-r" />
                  )}
                  <Icon size={16} strokeWidth={1.5} className="shrink-0" />
                  {!navCollapsed && <span className="truncate">{item.label}</span>}
                </button>
              );
            })}
          </div>

          {/* Nav collapse toggle */}
          <div className="p-2 border-t border-border">
            <button
              type="button"
              onClick={() => setNavCollapsed(!navCollapsed)}
              className="w-full flex items-center justify-center p-2 rounded text-ink-2 hover:text-ink hover:bg-surface-hover text-12 font-medium"
              aria-label={navCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {navCollapsed ? (
                <ChevronRight size={16} strokeWidth={1.5} />
              ) : (
                <div className="flex items-center gap-2">
                  <ChevronLeft size={16} strokeWidth={1.5} />
                  <span>Collapse Navigation</span>
                </div>
              )}
            </button>
          </div>
        </nav>

        {/* 3. Main Content Area on --canvas */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Breadcrumb row */}
          {breadcrumb && breadcrumb.length > 0 && (
            <div className="px-6 py-2 border-b border-border bg-surface text-12 text-ink-2 flex items-center gap-1.5 font-mono">
              {breadcrumb.map((crumb, idx) => (
                <React.Fragment key={crumb}>
                  {idx > 0 && <span className="text-ink-muted">/</span>}
                  <span className={idx === breadcrumb.length - 1 ? 'text-ink font-medium' : ''}>
                    {crumb}
                  </span>
                </React.Fragment>
              ))}
            </div>
          )}

          <main className="p-6 flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>

      {/* Changepoint Toast Notification per phase-3-realtime.md §6 */}
      {changepointToast && (
        <aside
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 max-w-md bg-surface border border-border shadow-panel rounded-lg p-3.5 space-y-1.5 animate-in fade-in slide-in-from-bottom-2 duration-150"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 text-primary font-semibold text-12">
              <Zap size={15} strokeWidth={1.5} />
              <span>Regime Shift Detected</span>
            </div>
            <button
              type="button"
              onClick={() => {
                if (toastTimerRef.current) {
                  clearTimeout(toastTimerRef.current);
                  toastTimerRef.current = null;
                }
                setChangepointToast(null);
              }}
              className="p-1 rounded text-ink-muted hover:text-ink"
              aria-label="Dismiss changepoint toast"
            >
              <X size={14} />
            </button>
          </div>

          {changepointToast.fact && (
            <div className="text-12 font-medium text-ink bg-surface-sunken p-2 rounded border border-border">
              {changepointToast.fact}
            </div>
          )}

          <div className="text-12 text-ink-2">
            {changepointToast.shift}
          </div>

          <div className="text-11 text-ink-muted font-mono flex items-center justify-between pt-1 border-t border-border">
            <span>Forecast horizon recalculating</span>
            <span>{changepointToast.ts}</span>
          </div>
        </aside>
      )}
    </div>
  );
};
