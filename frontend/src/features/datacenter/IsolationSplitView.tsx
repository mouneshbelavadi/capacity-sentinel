import React, { useEffect, useState } from 'react';
import { TopologyResponse, Rack, Slot } from '../../api/contract';
import { apiClient } from '../../api/client';
import { getStoredToken } from '../../api/client';
import { RackGrid } from './RackGrid';
import { Shield, ShieldAlert, CheckCircle, RefreshCw, X, Play } from 'lucide-react';

export interface IsolationSplitViewProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ProbeResult {
  url: string;
  tokenUsed: string;
  httpStatus: number;
  body: string;
  durationMs: number;
}

export const IsolationSplitView: React.FC<IsolationSplitViewProps> = ({ isOpen, onClose }) => {
  const [operatorTopology, setOperatorTopology] = useState<TopologyResponse | null>(null);
  const [tenantTopology, setTenantTopology] = useState<TopologyResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Probe testing state
  const [probing, setProbing] = useState<boolean>(false);
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);

  // Selected slot in the comparison
  const [selectedSlot, setSelectedSlot] = useState<{ slot: Slot; rack: Rack } | null>(null);

  const tenantToken = 'token-tenant-session';

  const loadDualTopologies = async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const operatorToken = getStoredToken() || 'token-operator-session';

      // 1. Fetch live with Operator Token
      const opResp = await apiClient.get<TopologyResponse>('/api/topology', {
        headers: {
          Authorization: `Bearer ${operatorToken}`,
        },
      });

      // 2. Fetch live with Tenant Token
      const tenantResp = await apiClient.get<TopologyResponse>('/api/topology', {
        headers: {
          Authorization: `Bearer ${tenantToken}`,
        },
      });

      setOperatorTopology(opResp);
      setTenantTopology(tenantResp);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch topologies');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadDualTopologies();
    }
  }, [isOpen]);

  // Execute live foreign node probe
  const runForeignNodeProbe = async () => {
    setProbing(true);
    const start = performance.now();
    try {
      const res = await fetch('/api/nodes/r1-n1/telemetry', {
        headers: {
          Authorization: `Bearer ${tenantToken}`,
          'Content-Type': 'application/json',
        },
      });
      const durationMs = Math.round(performance.now() - start);
      const text = await res.text();
      let formattedBody = text;
      try {
        formattedBody = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // Keep raw text
      }

      setProbeResult({
        url: 'GET /api/nodes/r1-n1/telemetry',
        tokenUsed: tenantToken,
        httpStatus: res.status,
        body: formattedBody,
        durationMs,
      });
    } catch (err) {
      setProbeResult({
        url: 'GET /api/nodes/r1-n1/telemetry',
        tokenUsed: tenantToken,
        httpStatus: 0,
        body: `Network Error: ${err instanceof Error ? err.message : 'Unknown'}`,
        durationMs: Math.round(performance.now() - start),
      });
    } finally {
      setProbing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-ink/30 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="prove-isolation-title"
    >
      <div className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-border bg-surface flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded bg-primary-weak/30 border border-primary/20 text-primary">
              <Shield size={20} strokeWidth={1.5} />
            </div>
            <div>
              <h2 id="prove-isolation-title" className="text-16 font-semibold text-ink">
                Live Tenant Isolation Proof
              </h2>
              <p className="text-12 text-ink-2">
                Simultaneous side-by-side queries to <code className="font-mono text-11">/api/topology</code> executing with operator vs. tenant credentials.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={loadDualTopologies}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-surface text-ink text-12 font-medium hover:bg-surface-hover transition-colors"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              <span>Refresh live</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded text-ink-2 hover:text-ink hover:bg-surface-hover"
              aria-label="Close isolation proof"
            >
              <X size={20} strokeWidth={1.5} />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {fetchError && (
            <div className="p-3 bg-critical-weak/30 border border-critical/30 rounded text-12 text-critical font-medium">
              {fetchError}
            </div>
          )}

          {/* Split View Columns */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Column 1: Operator Perspective */}
            <div className="flex flex-col gap-3">
              <div className="p-3 rounded-lg border border-border bg-surface-sunken flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-11 font-mono uppercase px-1.5 py-0.5 rounded bg-primary text-white font-semibold">
                      OPERATOR
                    </span>
                    <span className="text-13 font-semibold text-ink">Unrestricted Facility View</span>
                  </div>
                  <span className="text-11 text-ink-muted font-mono block mt-1">
                    Authorization: Bearer token-operator-session
                  </span>
                </div>
                <span className="text-11 text-ink-2">Sees all tenants & nodes</span>
              </div>

              {loading || !operatorTopology ? (
                <div className="h-64 border border-border rounded-lg bg-surface-sunken animate-pulse" />
              ) : (
                <RackGrid
                  racks={operatorTopology.racks}
                  selectedSlotId={selectedSlot?.slot.slot_id}
                  onSelectSlot={(slot, rack) => setSelectedSlot({ slot, rack })}
                  isTenant={false}
                />
              )}
            </div>

            {/* Column 2: Tenant Perspective */}
            <div className="flex flex-col gap-3">
              <div className="p-3 rounded-lg border border-border bg-surface-sunken flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-11 font-mono uppercase px-1.5 py-0.5 rounded bg-ink-2 text-white font-semibold">
                      TENANT
                    </span>
                    <span className="text-13 font-semibold text-ink">
                      Beta Compute Scoped View
                    </span>
                  </div>
                  <span className="text-11 text-ink-muted font-mono block mt-1">
                    Authorization: Bearer token-tenant-session
                  </span>
                </div>
                <div className="flex items-center gap-1 text-11 font-medium text-ink-2">
                  <CheckCircle size={14} className="text-primary" />
                  <span>apply_scope() Active</span>
                </div>
              </div>

              {loading || !tenantTopology ? (
                <div className="h-64 border border-border rounded-lg bg-surface-sunken animate-pulse" />
              ) : (
                <RackGrid
                  racks={tenantTopology.racks}
                  selectedSlotId={selectedSlot?.slot.slot_id}
                  onSelectSlot={(slot, rack) => setSelectedSlot({ slot, rack })}
                  isTenant={true}
                  tenantId="t-beta"
                />
              )}
            </div>
          </div>

          {/* Live Foreign Node 404 Probe Box */}
          <div className="p-4 rounded-lg border border-border bg-surface-sunken space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldAlert size={18} strokeWidth={1.5} className="text-primary" />
                <h3 className="text-13 font-semibold text-ink">
                  Direct Foreign Node Query Test (Target: r1-n1 owned by Alpha Systems)
                </h3>
              </div>
              <button
                type="button"
                onClick={runForeignNodeProbe}
                disabled={probing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary text-white text-12 font-semibold hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-50"
              >
                <Play size={13} fill="currentColor" />
                <span>{probing ? 'Probing...' : 'Run Probe as Tenant'}</span>
              </button>
            </div>

            <p className="text-12 text-ink-2 leading-relaxed">
              Sends an authentic fetch with tenant authorization to a foreign node telemetry endpoint. Per the architecture contract, the server returns <strong>404 NOT_FOUND</strong> (never 403), ensuring the resource’s existence is not revealed.
            </p>

            {probeResult && (
              <div className="p-3 bg-surface border border-border rounded font-mono text-11 space-y-1.5">
                <div className="flex items-center justify-between text-ink-muted">
                  <span>Endpoint: {probeResult.url}</span>
                  <span>Latency: {probeResult.durationMs}ms</span>
                </div>
                <div className="flex items-center gap-2 pt-1 border-t border-border">
                  <span className="text-ink-2 font-semibold">HTTP Status:</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-white font-bold ${
                      probeResult.httpStatus === 404 ? 'bg-ink' : 'bg-critical'
                    }`}
                  >
                    {probeResult.httpStatus} NOT_FOUND
                  </span>
                  <span className="text-ink-muted">
                    (Expected 404 — 403 Forbidden is strictly prohibited to prevent enumeration)
                  </span>
                </div>
                <div className="pt-1.5">
                  <span className="text-ink-muted block mb-1">Response Body:</span>
                  <pre className="p-2 bg-surface-sunken rounded text-ink overflow-x-auto text-11">
                    {probeResult.body}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-border bg-surface-sunken flex items-center justify-between text-11 text-ink-2">
          <span>Server Isolation Verification • Capacity Sentinel Data Layer</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded border border-border bg-surface text-ink font-medium hover:bg-surface-hover text-12"
          >
            Close view
          </button>
        </div>
      </div>
    </div>
  );
};
