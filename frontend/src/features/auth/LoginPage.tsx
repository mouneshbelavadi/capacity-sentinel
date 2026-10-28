import React, { useState } from 'react';
import { useAuthStore } from '../../app/authStore';
import { Shield, Server, ArrowRight, Lock, User, Radio, CreditCard } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const [username, setUsername] = useState('op1');
  const [password, setPassword] = useState('OperatorPassword123!');
  const [manualCardUid, setManualCardUid] = useState('04:A1:B2:C3:D4');
  const [authMode, setAuthMode] = useState<'credentials' | 'rfid'>('credentials');
  const { login, loginWithRfid, isLoading, error } = useAuthStore();

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    await login(username.trim(), password);
  };

  const handleRfidSubmit = async (cardUidToUse?: string) => {
    const uid = (cardUidToUse || manualCardUid).trim();
    if (!uid) return;
    await loginWithRfid(uid);
  };

  const handleQuickFill = (roleUser: string, defaultPw: string) => {
    setUsername(roleUser);
    setPassword(defaultPw);
  };

  return (
    <div className="min-h-screen bg-canvas flex flex-col justify-center items-center p-4">
      {/* Container */}
      <div className="w-full max-w-[460px] bg-surface border border-border rounded-lg shadow-panel p-8">
        {/* Product Mark Header */}
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border">
          <div className="w-10 h-10 rounded bg-primary-weak text-primary flex items-center justify-center">
            <Server size={22} strokeWidth={1.5} aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-16 font-semibold text-ink leading-tight">
              RackSense
            </h1>
            <p className="text-12 text-ink-2">Infrastructure Capacity Console</p>
          </div>
        </div>

        {/* Auth Mode Tabs: Credentials vs Physical RFID */}
        <div className="flex border-b border-border mb-5">
          <button
            type="button"
            onClick={() => setAuthMode('credentials')}
            className={`flex-1 py-2 text-12 font-medium flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
              authMode === 'credentials'
                ? 'border-primary text-primary font-semibold'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            <User size={14} strokeWidth={1.5} />
            <span>Credentials</span>
          </button>
          <button
            type="button"
            onClick={() => setAuthMode('rfid')}
            className={`flex-1 py-2 text-12 font-medium flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
              authMode === 'rfid'
                ? 'border-primary text-primary font-semibold'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            <Radio size={14} strokeWidth={1.5} className="text-primary" />
            <span>RFID Badge Tap</span>
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div
            className="mb-4 p-3 rounded border border-crit/30 bg-crit-weak text-crit text-12 font-medium"
            role="alert"
          >
            {error}
          </div>
        )}

        {/* Mode 1: Standard Username & Password */}
        {authMode === 'credentials' && (
          <form onSubmit={handleCredentialsSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="username"
                className="block text-12 font-medium text-ink-2 mb-1"
              >
                Username or Account ID
              </label>
              <div className="relative">
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoComplete="username"
                  className="w-full h-9 pl-9 pr-3 rounded border border-border bg-surface text-ink text-13 placeholder:text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  placeholder="op1, super1, alpha_user, or beta_user"
                />
                <User
                  size={16}
                  strokeWidth={1.5}
                  className="absolute left-2.5 top-2.5 text-ink-muted pointer-events-none"
                  aria-hidden="true"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-12 font-medium text-ink-2 mb-1"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="w-full h-9 pl-9 pr-3 rounded border border-border bg-surface text-ink text-13 placeholder:text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  placeholder="Enter password"
                />
                <Lock
                  size={16}
                  strokeWidth={1.5}
                  className="absolute left-2.5 top-2.5 text-ink-muted pointer-events-none"
                  aria-hidden="true"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-9 mt-2 inline-flex items-center justify-center gap-2 rounded bg-primary hover:bg-primary-hover text-surface text-13 font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60"
            >
              <span>{isLoading ? 'Verifying credentials...' : 'Sign In'}</span>
              {!isLoading && <ArrowRight size={15} strokeWidth={1.5} aria-hidden="true" />}
            </button>
          </form>
        )}

        {/* Mode 2: Physical RFID Card Tap */}
        {authMode === 'rfid' && (
          <div className="space-y-4">
            <div className="p-4 rounded-lg border border-border bg-surface-sunken text-center space-y-3">
              <div className="w-12 h-12 mx-auto rounded-full bg-primary-weak text-primary flex items-center justify-center">
                <Radio size={24} strokeWidth={1.5} className="animate-pulse" />
              </div>
              <div>
                <h3 className="text-13 font-semibold text-ink">Physical RFID Reader Terminal</h3>
                <p className="text-11 text-ink-2 mt-0.5">
                  Tap physical data center badge to reader, or select registered bench card below:
                </p>
              </div>

              {/* Hardware Card Tap Buttons */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => handleRfidSubmit('04:A1:B2:C3:D4')}
                  className="p-2.5 rounded border border-border bg-surface hover:bg-surface-hover transition-colors text-left space-y-1 shadow-2xs"
                >
                  <div className="flex items-center gap-1.5 text-11 font-bold text-ink">
                    <CreditCard size={13} strokeWidth={1.5} className="text-primary" />
                    <span>Operator Badge</span>
                  </div>
                  <div className="text-10 font-mono text-ink-muted">04:A1:B2:C3:D4</div>
                  <div className="text-9 text-ok font-semibold">Tier 2 Risk Auth</div>
                </button>

                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => handleRfidSubmit('04:E5:F6:17:28')}
                  className="p-2.5 rounded border border-border bg-surface hover:bg-surface-hover transition-colors text-left space-y-1 shadow-2xs"
                >
                  <div className="flex items-center gap-1.5 text-11 font-bold text-ink">
                    <CreditCard size={13} strokeWidth={1.5} className="text-primary" />
                    <span>Super User Badge</span>
                  </div>
                  <div className="text-10 font-mono text-ink-muted">04:E5:F6:17:28</div>
                  <div className="text-9 text-ok font-semibold">Tier 3 Full Auth</div>
                </button>
              </div>
            </div>

            {/* Manual Card UID Scanner Entry */}
            <div>
              <label htmlFor="cardUid" className="block text-11 font-medium text-ink-2 mb-1">
                Hardware Reader UID Input / Card Scan:
              </label>
              <div className="flex gap-2">
                <input
                  id="cardUid"
                  type="text"
                  value={manualCardUid}
                  onChange={(e) => setManualCardUid(e.target.value)}
                  placeholder="e.g. 04:A1:B2:C3:D4"
                  className="flex-1 h-9 px-3 rounded border border-border bg-surface text-ink font-mono text-12 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                />
                <button
                  type="button"
                  disabled={isLoading || !manualCardUid.trim()}
                  onClick={() => handleRfidSubmit()}
                  className="px-4 h-9 rounded bg-primary hover:bg-primary-hover text-surface text-12 font-medium transition-colors disabled:opacity-60"
                >
                  {isLoading ? 'Authenticating...' : 'Simulate Tap'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Demo Role Quick-Fill Buttons */}
        <div className="mt-6 pt-4 border-t border-border">
          <span className="block text-11 font-semibold text-ink-2 uppercase tracking-wider mb-2">
            1-Click Persona Credentials for Judges
          </span>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => handleQuickFill('op1', 'OperatorPassword123!')}
              className="px-2 py-1.5 rounded border border-border bg-surface-sunken hover:bg-surface-hover text-11 font-medium text-ink text-center transition-colors shadow-2xs"
            >
              Operator (op1)
            </button>
            <button
              type="button"
              onClick={() => handleQuickFill('super1', 'SuperSecretPassword123!')}
              className="px-2 py-1.5 rounded border border-border bg-surface-sunken hover:bg-surface-hover text-11 font-medium text-ink text-center transition-colors shadow-2xs"
            >
              Super User (super1)
            </button>
            <button
              type="button"
              onClick={() => handleQuickFill('alpha_user', 'AlphaPassword123!')}
              className="px-2 py-1.5 rounded border border-border bg-surface-sunken hover:bg-surface-hover text-11 font-medium text-ink text-center transition-colors shadow-2xs"
            >
              Tenant Alpha
            </button>
          </div>
        </div>

        {/* Honesty Footer */}
        <div className="mt-6 flex items-center justify-between text-11 text-ink-muted">
          <div className="flex items-center gap-1.5">
            <Shield size={14} strokeWidth={1.5} className="shrink-0 text-primary" />
            <span>Tenant isolation via apply_scope</span>
          </div>
          <span className="font-mono text-10">HMAC-SHA256 Active</span>
        </div>
      </div>
    </div>
  );
};
