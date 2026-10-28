import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { TopologyResponse, Rack, Slot, Status, Metric } from '../../api/contract';
import { apiClient, ApiClientError } from '../../api/client';
import { useWebSocket } from '../../api/ws';
import { Card } from '../../design/Card';
import { DataTable, Column } from '../../design/DataTable';
import { EmptyState } from '../../design/EmptyState';
import { ErrorState } from '../../design/ErrorState';
import { StatusBadge } from '../../design/StatusBadge';
import { RackHallCanvas } from '../hall/RackHallCanvas';
import { VisualManagementView } from '../hall/VisualManagementView';
import { RackSummaryCard } from './RackSummaryCard';
import { SlotDetailPanel } from '../topology/SlotDetailPanel';
import { IsolationSplitView } from './IsolationSplitView';
import { Server, Activity, Shield, Filter, ChevronRight, Maximize2 } from 'lucide-react';

interface ActivityItem {
  id: string;
  ts: string;
  event: string;
  subject: string;
  status: string;
}

export interface DataCenterDashboardProps {
  onlyRacks?: boolean;
}

export const DataCenterDashboard: React.FC<DataCenterDashboardProps> = ({ onlyRacks = false }) => {
  const [topology, setTopology] = useState<TopologyResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<ApiClientError | null>(null);

  // Filters & Selection
  const [selectedRackId, setSelectedRackId] = useState<string>('rack-01');
  const [tenantFilter, setTenantFilter] = useState<string>('all');
  const [metricFilter, setMetricFilter] = useState<string>('all');

  // Slot detail slide-in panel state
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [selectedRack, setSelectedRack] = useState<Rack | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState<boolean>(false);

  // Isolation proof modal state
  const [isIsolationModalOpen, setIsIsolationModalOpen] = useState<boolean>(false);
  const [isRacksTotalView, setIsRacksTotalView] = useState<boolean>(false);

  const fetchTopology = useCallback(async () => {
    try {
      const data = await apiClient.get<TopologyResponse>('/api/topology');
      setTopology(data);
      if (data.racks.length > 0 && !selectedRackId) {
        setSelectedRackId(data.racks[0].rack_id);
      }
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err
          : new ApiClientError(500, 'INTERNAL', err instanceof Error ? err.message : 'Unknown error')
      );
    } finally {
      setLoading(false);
    }
  }, [selectedRackId]);

  useEffect(() => {
    setLoading(true);
    fetchTopology();
  }, [fetchTopology]);

  // Subscription follows the view per phase-3-realtime.md §8
  const subConfig = useMemo(
    () => ({
      racks: selectedRackId ? [selectedRackId] : ['rack-01'],
      metrics: ['t_c', 'rh', 'vib_rms_g', 'power_w', 'mq_ratio'] as Metric[],
    }),
    [selectedRackId]
  );

  // WebSocket hook with REST resync on reconnect
  const {
    status: wsStatus,
    nodeStatuses,
    escalationSlotIds,
    recentAudits,
    telemetry,
  } = useWebSocket(subConfig, fetchTopology);

  const handleSelectSlot = (slot: Slot | null, rack: Rack | null) => {
    if (!slot || !slot.slot_id) {
      setSelectedSlot(null);
      setSelectedRack(null);
      setIsDetailOpen(false);
      return;
    }
    setSelectedSlot(slot);
    setSelectedRack(rack);
    if (rack) {
      setSelectedRackId(rack.rack_id);
    }
    setIsDetailOpen(true);
  };

  // Filter slots if tenant filter is applied
  const filteredRacks = topology
    ? topology.racks.map((rack) => {
        if (tenantFilter === 'all') return rack;
        return {
          ...rack,
          slots: rack.slots.filter((s) => s.tenant_id === tenantFilter),
        };
      })
    : [];

  const activeRack = topology?.racks.find((r) => r.rack_id === selectedRackId) || topology?.racks[0];

  // Recent activity populated from live audit_append frames
  const activityItems: ActivityItem[] = recentAudits.map((a) => ({
    id: `${a.seq}-${a.hash.slice(0, 8)}`,
    ts: new Date(a.ts).toLocaleTimeString(),
    event: a.event,
    subject: `seq #${a.seq}`,
    status: `${a.hash.slice(0, 10)}...`,
  }));

  const activityColumns: Column<ActivityItem>[] = [
    { key: 'ts', header: 'Timestamp', render: (i) => <span className="font-mono text-11 text-ink-2">{i.ts}</span> },
    { key: 'event', header: 'Event', render: (i) => <span className="text-12 font-medium text-ink">{i.event}</span> },
    { key: 'subject', header: 'Subject', render: (i) => <span className="font-mono text-11 text-primary">{i.subject}</span> },
    { key: 'status', header: 'Hash', align: 'right', render: (i) => <span className="text-11 font-mono text-ink-muted">{i.status}</span> },
  ];

  return (
    <div className="space-y-6" data-testid="datacenter-dashboard">
      {/* Top Banner & Prove Isolation Trigger (Omitted on Racks-only page) */}
      {!onlyRacks && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-surface border border-border rounded-lg shadow-card">
          <div>
            <h2 className="text-14 font-semibold text-ink">Site-01 Facility Overview</h2>
            <p className="text-12 text-ink-2 mt-0.5">
              Physical topology and operational thermal margins for all data center racks.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsIsolationModalOpen(true)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-primary-weak/40 border border-primary/30 text-primary text-12 font-semibold hover:bg-primary-weak/70 transition-colors shadow-sm self-start sm:self-auto"
            aria-label="Open Prove Isolation view"
          >
            <Shield size={16} strokeWidth={1.5} />
            <span>Prove isolation</span>
          </button>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-pulse">
          <div className="lg:col-span-3 h-80 bg-surface border border-border rounded-lg" />
          <div className="lg:col-span-6 h-80 bg-surface border border-border rounded-lg" />
          <div className="lg:col-span-3 h-80 bg-surface border border-border rounded-lg" />
        </div>
      ) : error ? (
        <ErrorState
          code={error.code}
          message={error.message || 'Unable to load facility topology'}
          detail={error.detail}
        />
      ) : isRacksTotalView ? (
        <VisualManagementView
          topology={topology}
          selectedRackId={selectedRackId}
          selectedSlot={selectedSlot}
          onSelectSlot={handleSelectSlot}
          isTenant={false}
          nodeStatuses={nodeStatuses}
          escalationSlotIds={escalationSlotIds}
          telemetry={telemetry}
          isStale={wsStatus === 'stale'}
        />
      ) : onlyRacks ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Rail (3 cols): Keyboard-navigable Rack list */}
          <aside className="lg:col-span-3 space-y-4">
            <div className="border border-border rounded-lg bg-surface shadow-card overflow-hidden">
              <div className="px-4 py-3 bg-surface-sunken border-b border-border flex items-center justify-between">
                <span className="text-12 font-semibold uppercase tracking-wider text-ink-2">
                  Facility Racks
                </span>
                <span className="text-11 font-mono text-ink-muted">
                  {topology?.racks.length || 0} Total
                </span>
              </div>
              <div className="p-2 space-y-1">
                {topology?.racks.map((rack) => {
                  const isSelected = selectedRackId === rack.rack_id;
                  const hasCrit = rack.slots.some((s) => s.status === 'CRIT');
                  const hasWarn = rack.slots.some((s) => s.status === 'WARN');
                  const hasOffline = rack.slots.some(
                    (s) => s.node_id && nodeStatuses[s.node_id]?.status === 'offline'
                  );
                  const rackStatus = hasCrit ? 'CRIT' : hasWarn ? 'WARN' : hasOffline ? 'WARN' : 'OK';

                  return (
                    <div key={rack.rack_id} className="space-y-1">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedRackId(rack.rack_id);
                          if (rack.slots.length > 0 && selectedRack?.rack_id !== rack.rack_id) {
                            handleSelectSlot(rack.slots[0], rack);
                          }
                        }}
                        className={`w-full p-2.5 rounded text-left transition-colors flex items-center justify-between ${
                          isSelected
                            ? 'bg-primary-weak/40 border-l-2 border-primary font-medium text-primary'
                            : 'hover:bg-surface-hover text-ink'
                        }`}
                        aria-expanded={isSelected}
                        aria-label={`Select ${rack.label}`}
                      >
                        <div className="flex items-center gap-2">
                          <Server size={16} strokeWidth={1.5} className={isSelected ? 'text-primary' : 'text-ink-2'} />
                          <div>
                            <div className="text-12 font-semibold">{rack.label}</div>
                            <div className="text-11 font-mono text-ink-muted">
                              {rack.slots.length} bays • Row {rack.position.row}, Col {rack.position.col}
                            </div>
                          </div>
                        </div>
                        <StatusBadge status={rackStatus} size="sm" />
                      </button>

                      {isSelected && (
                        <div className="ml-3 pl-2.5 border-l border-border/80 space-y-1 py-1" role="list" aria-label={`${rack.label} bays`}>
                          {rack.slots.map((slot) => {
                            const isSlotSelected = selectedSlot?.slot_id === slot.slot_id;
                            const liveNode = slot.node_id ? nodeStatuses[slot.node_id] : undefined;
                            const effectiveStatus: Status = liveNode?.status === 'offline' ? 'OFFLINE' : slot.status;

                            return (
                              <button
                                key={slot.slot_id}
                                type="button"
                                onClick={() => handleSelectSlot(slot, rack)}
                                className={`w-full px-2 py-1.5 rounded text-left text-11 flex items-center justify-between transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
                                  isSlotSelected
                                    ? 'bg-primary text-white font-medium shadow-xs'
                                    : 'hover:bg-surface-hover text-ink-2'
                                }`}
                                aria-label={`Select slot U${slot.u_start} (${slot.node_id || 'unlet'}) with status ${effectiveStatus}`}
                              >
                                <div className="flex items-center gap-1.5 truncate">
                                  <ChevronRight size={12} strokeWidth={1.5} className={isSlotSelected ? 'text-white' : 'text-ink-muted'} />
                                  <span className="font-mono font-medium">U{slot.u_start}</span>
                                  <span className={`truncate text-10 ${isSlotSelected ? 'text-white/80' : 'text-ink-muted'}`}>
                                    ({slot.node_id || 'unlet'})
                                  </span>
                                </div>
                                <StatusBadge status={effectiveStatus} size="sm" />
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>

          {/* Centre (6 cols): 3D Rack Hall */}
          <main className="lg:col-span-6 space-y-4">
            <Card
              title="Live 3D Data Hall"
              subtitle="Real-time physical spatial hall view with data-driven WebGL rendering"
              actions={
                <button
                  type="button"
                  onClick={() => setIsRacksTotalView(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-primary text-white text-11 font-medium hover:bg-primary-hover transition-colors shadow-xs"
                  title="Expand to Full Page Total View with Side Metrics"
                  data-testid="expand-racks-total-view-btn"
                >
                  <Maximize2 size={13} strokeWidth={1.5} />
                  <span>Total View</span>
                </button>
              }
            >
              <RackHallCanvas
                racks={filteredRacks}
                selectedRackId={selectedRackId}
                selectedSlotId={selectedSlot?.slot_id}
                onSelectSlot={handleSelectSlot}
                isTenant={false}
                nodeStatuses={nodeStatuses}
                escalationSlotIds={escalationSlotIds}
                telemetryByNodeMetric={telemetry}
                isStale={wsStatus === 'stale'}
                onToggleTotalView={() => setIsRacksTotalView(true)}
              />
            </Card>
          </main>

          {/* Right Column (3 cols): Rack Summary */}
          <aside className="lg:col-span-3 space-y-4">
            {activeRack ? (
              <RackSummaryCard
                rackId={activeRack.rack_id}
                rackLabel={activeRack.label}
              />
            ) : (
              <Card title="Rack Summary">
                <p className="text-12 text-ink-muted">Select a rack to inspect margin limits.</p>
              </Card>
            )}
          </aside>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Visual Management Hero View */}
          <VisualManagementView
            topology={topology}
            selectedRackId={selectedRackId}
            selectedSlot={selectedSlot}
            onSelectSlot={handleSelectSlot}
            isTenant={false}
            nodeStatuses={nodeStatuses}
            escalationSlotIds={escalationSlotIds}
            telemetry={telemetry}
            isStale={wsStatus === 'stale'}
          />

          {/* Operational Secondary Panels: Keyboard-navigable Rack/Slot bay list & Selected Rack Summary */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <aside className="lg:col-span-4 space-y-4">
              {/* Rack Selector Panel */}
              <div className="border border-border rounded-lg bg-surface shadow-card overflow-hidden">
                <div className="px-4 py-3 bg-surface-sunken border-b border-border flex items-center justify-between">
                  <span className="text-12 font-semibold uppercase tracking-wider text-ink-2">
                    Facility Racks
                  </span>
                  <span className="text-11 font-mono text-ink-muted">
                    {topology?.racks.length || 0} Total
                  </span>
                </div>
                <div className="p-2 space-y-1">
                  {topology?.racks.map((rack) => {
                    const isSelected = selectedRackId === rack.rack_id;
                    const hasCrit = rack.slots.some((s) => s.status === 'CRIT');
                    const hasWarn = rack.slots.some((s) => s.status === 'WARN');
                    const hasOffline = rack.slots.some(
                      (s) => s.node_id && nodeStatuses[s.node_id]?.status === 'offline'
                    );
                    const rackStatus = hasCrit ? 'CRIT' : hasWarn ? 'WARN' : hasOffline ? 'WARN' : 'OK';

                    return (
                      <div key={rack.rack_id} className="space-y-1">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedRackId(rack.rack_id);
                            if (rack.slots.length > 0 && selectedRack?.rack_id !== rack.rack_id) {
                              handleSelectSlot(rack.slots[0], rack);
                            }
                          }}
                          className={`w-full p-2.5 rounded text-left transition-colors flex items-center justify-between ${
                            isSelected
                              ? 'bg-primary-weak/40 border-l-2 border-primary font-medium text-primary'
                              : 'hover:bg-surface-hover text-ink'
                          }`}
                          aria-expanded={isSelected}
                          aria-label={`Select ${rack.label}`}
                        >
                          <div className="flex items-center gap-2">
                            <Server size={16} strokeWidth={1.5} className={isSelected ? 'text-primary' : 'text-ink-2'} />
                            <div>
                              <div className="text-12 font-semibold">{rack.label}</div>
                              <div className="text-11 font-mono text-ink-muted">
                                {rack.slots.length} bays • Row {rack.position.row}, Col {rack.position.col}
                              </div>
                            </div>
                          </div>
                          <StatusBadge status={rackStatus} size="sm" />
                        </button>

                        {isSelected && (
                          <div className="ml-3 pl-2.5 border-l border-border/80 space-y-1 py-1" role="list" aria-label={`${rack.label} bays`}>
                            {rack.slots.map((slot) => {
                              const isSlotSelected = selectedSlot?.slot_id === slot.slot_id;
                              const liveNode = slot.node_id ? nodeStatuses[slot.node_id] : undefined;
                              const effectiveStatus: Status = liveNode?.status === 'offline' ? 'OFFLINE' : slot.status;

                              return (
                                <button
                                  key={slot.slot_id}
                                  type="button"
                                  onClick={() => handleSelectSlot(slot, rack)}
                                  className={`w-full px-2 py-1.5 rounded text-left text-11 flex items-center justify-between transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
                                    isSlotSelected
                                      ? 'bg-primary text-white font-medium shadow-xs'
                                      : 'hover:bg-surface-hover text-ink-2'
                                  }`}
                                  aria-label={`Select slot U${slot.u_start} (${slot.node_id || 'unlet'}) with status ${effectiveStatus}`}
                                >
                                  <div className="flex items-center gap-1.5 truncate">
                                    <ChevronRight size={12} strokeWidth={1.5} className={isSlotSelected ? 'text-white' : 'text-ink-muted'} />
                                    <span className="font-mono font-medium">U{slot.u_start}</span>
                                    <span className={`truncate text-10 ${isSlotSelected ? 'text-white/80' : 'text-ink-muted'}`}>
                                      ({slot.node_id || 'unlet'})
                                    </span>
                                  </div>
                                  <StatusBadge status={effectiveStatus} size="sm" />
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* View Filters */}
              <div className="border border-border rounded-lg bg-surface p-4 shadow-card space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-border">
                  <Filter size={14} strokeWidth={1.5} className="text-ink-2" />
                  <h4 className="text-12 font-semibold text-ink">View Filters</h4>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="tenant-select" className="block text-11 font-medium text-ink-2 uppercase">
                    Tenant Scope
                  </label>
                  <select
                    id="tenant-select"
                    value={tenantFilter}
                    onChange={(e) => setTenantFilter(e.target.value)}
                    className="w-full text-12 p-2 rounded border border-border bg-surface text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <option value="all">All Tenants</option>
                    <option value="t-alpha">Alpha Systems (t-alpha)</option>
                    <option value="t-beta">Beta Compute (t-beta)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="metric-select" className="block text-11 font-medium text-ink-2 uppercase">
                    Telemetry Metric
                  </label>
                  <select
                    id="metric-select"
                    value={metricFilter}
                    onChange={(e) => setMetricFilter(e.target.value)}
                    disabled
                    title="Metric filtering in 3D scene is not supported; all metrics stream concurrently."
                    className="w-full text-12 p-2 rounded border border-border bg-surface text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="all">All Metrics</option>
                    <option value="t_c">Inlet Temperature (°C)</option>
                    <option value="rh">Relative Humidity (%)</option>
                    <option value="vib_rms_g">Vibration RMS (g)</option>
                    <option value="power_w">Estimated Power (W)</option>
                  </select>
                </div>
              </div>
            </aside>

            {/* Right Side (8 cols): Selected Rack Summary */}
            <main className="lg:col-span-8 space-y-4">
              {activeRack ? (
                <RackSummaryCard
                  rackId={activeRack.rack_id}
                  rackLabel={activeRack.label}
                />
              ) : (
                <Card title="Rack Summary">
                  <p className="text-12 text-ink-muted">Select a rack to inspect margin limits.</p>
                </Card>
              )}
            </main>
          </div>
        </div>
      )}

      {/* Bottom: Recent Activity Card (Omitted on Racks-only page) */}
      {!onlyRacks && (
        <Card
          title="Recent Activity"
          subtitle="Audit log stream and automated telemetry events across the facility"
        >
          <DataTable
            columns={activityColumns}
            data={activityItems}
            keyExtractor={(item) => item.id}
            emptyState={
              <EmptyState
                icon={Activity}
                title="No Recent Activity Recorded"
                description="Audit events, threshold alerts, and RFID actions will populate here once telemetry streams."
              />
            }
          />
        </Card>
      )}

      {/* Slot and Node Detail Panel */}
      <SlotDetailPanel
        slot={selectedSlot}
        rack={selectedRack}
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        isTenant={false}
      />

      {/* Prove Isolation Split View Modal */}
      <IsolationSplitView
        isOpen={isIsolationModalOpen}
        onClose={() => setIsIsolationModalOpen(false)}
      />
    </div>
  );
};
