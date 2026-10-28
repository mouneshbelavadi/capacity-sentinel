import React, { useState } from 'react';
import { useAuthStore } from '../../app/authStore';
import { Shield, Server, ArrowRight, Lock, User } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const [username, setUsername] = useState('operator');
  const [password, setPassword] = useState('password123');
  const { login, isLoading, error } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    await login(username.trim(), password);
  };

  const handleQuickFill = (roleUser: string) => {
    setUsername(roleUser);
    setPassword('password123');
  };

  return (
    <div className="min-h-screen bg-canvas flex flex-col justify-center items-center p-4">
      {/* Container */}
      <div className="w-full max-w-[420px] bg-surface border border-border rounded-lg shadow-panel p-8">
        {/* Product Mark Header */}
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border">
          <div className="w-9 h-9 rounded bg-primary-weak text-primary flex items-center justify-center">
            <Server size={20} strokeWidth={1.5} aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-16 font-semibold text-ink leading-tight">
              RackSense
            </h1>
            <p className="text-12 text-ink-2">Infrastructure Capacity Console</p>
          </div>
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

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
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
                placeholder="operator, tenant, or superuser"
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

        {/* Demo Role Selector Helpers */}
        <div className="mt-6 pt-4 border-t border-border">
          <span className="block text-11 font-medium text-ink-2 uppercase tracking-wider mb-2">
            Select Role Identity for Evaluation
          </span>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => handleQuickFill('operator')}
              className="px-2 py-1.5 rounded border border-border bg-surface-sunken hover:bg-surface-hover text-11 font-medium text-ink text-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              Operator
            </button>
            <button
              type="button"
              onClick={() => handleQuickFill('tenant')}
              className="px-2 py-1.5 rounded border border-border bg-surface-sunken hover:bg-surface-hover text-11 font-medium text-ink text-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              Tenant
            </button>
            <button
              type="button"
              onClick={() => handleQuickFill('superuser')}
              className="px-2 py-1.5 rounded border border-border bg-surface-sunken hover:bg-surface-hover text-11 font-medium text-ink text-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              Super User
            </button>
          </div>
        </div>

        {/* Honesty Footer */}
        <div className="mt-6 flex items-center gap-2 text-11 text-ink-muted">
          <Shield size={14} strokeWidth={1.5} className="shrink-0" />
          <span>Server-side tenant isolation enforced via apply_scope</span>
        </div>
      </div>
    </div>
  );
};
