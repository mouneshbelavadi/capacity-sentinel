import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { TopologyResponse, Rack, Slot, Status, Metric } from '../../api/contract';
import { apiClient, ApiClientError } from '../../api/client';
import { useAuthStore } from '../../app/authStore';
import { useWebSocket } from '../../api/ws';
import { Card } from '../../design/Card';
import { DataTable, Column } from '../../design/DataTable';
import { EmptyState } from '../../design/EmptyState';
import { ErrorState } from '../../design/ErrorState';
import { StatusBadge } from '../../design/StatusBadge';
import { RackHallCanvas } from '../hall/RackHallCanvas';
import { VisualManagementView } from '../hall/VisualManagementView';
import { RackSummaryCard } from '../datacenter/RackSummaryCard';
import { SlotDetailPanel } from '../topology/SlotDetailPanel';
import { Server, Activity, Shield, Lock, ChevronRight, Maximize2 } from 'lucide-react';

interface TenantActivityItem {
  id: string;
  ts: string;
  event: string;
  node_id: string;
}

export interface TenantDashboardProps {
  onlyRacks?: boolean;
}

export const TenantDashboard: React.FC<TenantDashboardProps> = ({ onlyRacks = false }) => {
  const { user } = useAuthStore();
  const tenantLabel = user?.display_name || 'Beta Compute (Tenant)';
  const tenantId = user?.tenant_id || 't-beta';

  const [topology, setTopology] = useState<TopologyResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<ApiClientError | null>(null);

  const [selectedRackId, setSelectedRackId] = useState<string>('rack-01');
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [selectedRack, setSelectedRack] = useState<Rack | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState<boolean>(false);
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
    // Prevent selecting foreign slots in tenant view
    if (slot.status === 'UNKNOWN' || (tenantId && slot.tenant_id && slot.tenant_id !== tenantId)) {
      return;
    }
    setSelectedSlot(slot);
    setSelectedRack(rack);
    if (rack) {
      setSelectedRackId(rack.rack_id);
    }
    setIsDetailOpen(true);
  };

  const activeRack = topology?.racks.find((r) => r.rack_id === selectedRackId) || topology?.racks[0];

  // Count owned slots across topology
  const ownedSlotsCount =
    topology?.racks.reduce(
      (sum, r) => sum + r.slots.filter((s) => s.tenant_id === tenantId).length,
      0
    ) || 0;

  // Filter audit events scoped to tenant
  const tenantActivityItems: TenantActivityItem[] = recentAudits.map((a) => ({
    id: `${a.seq}-${a.hash.slice(0, 8)}`,
    ts: new Date(a.ts).toLocaleTimeString(),
    event: a.event,
    node_id: `seq #${a.seq}`,
  }));

  const activityColumns: Column<TenantActivityItem>[] = [
    { key: 'ts', header: 'Timestamp', render: (i) => <span className="font-mono text-11 text-ink-2">{i.ts}</span> },
    { key: 'event', header: 'Event', render: (i) => <span className="text-12 font-medium text-ink">{i.event}</span> },
    { key: 'node_id', header: 'Subject', render: (i) => <span className="font-mono text-11 text-primary">{i.node_id}</span> },
  ];

  return (
    <div className="space-y-6" data-testid="tenant-dashboard">
      {/* Isolation Status Banner (Omitted on Racks-only page) */}
      {!onlyRacks && (
        <div className="p-4 bg-surface border border-border rounded-lg shadow-card flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded bg-primary-weak/40 border border-primary/20 text-primary">
              <Shield size={18} strokeWidth={1.5} />
            </div>
            <div>
              <h2 className="text-14 font-semibold text-ink">
                Scoped to tenant: {tenantLabel}
              </h2>
              <p className="text-12 text-ink-2 mt-0.5">
                Authorized scope: <code className="font-mono text-primary font-medium">{tenantId}</code> • {ownedSlotsCount} active server bays
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto text-11 font-mono text-ink-muted bg-surface-sunken px-2.5 py-1 rounded border border-border">
            <Lock size={12} strokeWidth={1.5} />
            <span>Server Isolation Active</span>
          </div>
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
          message={error.message || 'Unable to retrieve tenant topology'}
          detail={error.detail}
        />
      ) : isRacksTotalView ? (
        <VisualManagementView
          topology={topology}
          selectedRackId={selectedRackId}
          selectedSlot={selectedSlot}
          onSelectSlot={handleSelectSlot}
          isTenant={true}
          tenantId={tenantId}
          nodeStatuses={nodeStatuses}
          escalationSlotIds={escalationSlotIds}
          telemetry={telemetry}
          isStale={wsStatus === 'stale'}
        />
      ) : onlyRacks ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Rail (3 cols): Rack list */}
          <aside className="lg:col-span-3 space-y-4">
            <div className="border border-border rounded-lg bg-surface shadow-card overflow-hidden">
              <div className="px-4 py-3 bg-surface-sunken border-b border-border flex items-center justify-between">
                <span className="text-12 font-semibold uppercase tracking-wider text-ink-2">
                  Assigned Racks
                </span>
                <span className="text-11 font-mono text-ink-muted">
                  {topology?.racks.length || 0} Racks
                </span>
              </div>
              <div className="p-2 space-y-1">
                {topology?.racks.map((rack) => {
                  const isSelected = selectedRackId === rack.rack_id;
                  const mySlotsInRack = rack.slots.filter((s) => s.tenant_id === tenantId);

                  return (
                    <div key={rack.rack_id} className="space-y-1">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedRackId(rack.rack_id);
                          if (mySlotsInRack.length > 0 && selectedRack?.rack_id !== rack.rack_id) {
                            handleSelectSlot(mySlotsInRack[0], rack);
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
                              {mySlotsInRack.length} bay{mySlotsInRack.length === 1 ? '' : 's'} allocated
                            </div>
                          </div>
                        </div>
                        <span className="text-11 font-mono text-ink-2 font-medium">
                          Row {rack.position.row}
                        </span>
                      </button>

                      {isSelected && (
                        <div className="ml-3 pl-2.5 border-l border-border/80 space-y-1 py-1" role="list" aria-label={`${rack.label} allocated bays`}>
                          {mySlotsInRack.map((slot) => {
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
                                aria-label={`Select bay U${slot.u_start} (${slot.node_id || 'unlet'}) with status ${effectiveStatus}`}
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

          {/* Centre (6 cols): 3D Hall */}
          <main className="lg:col-span-6 space-y-4">
            <Card
              title="Live 3D Data Hall"
              subtitle="Your rented bay capacity shown beside shielded facility bays"
              actions={
                <button
                  type="button"
                  onClick={() => setIsRacksTotalView(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-primary text-white text-11 font-medium hover:bg-primary-hover transition-colors shadow-xs"
                  title="Expand to Full Page Total View with Side Metrics"
                  data-testid="expand-tenant-racks-total-view-btn"
                >
                  <Maximize2 size={13} strokeWidth={1.5} />
                  <span>Total View</span>
                </button>
              }
            >
              <RackHallCanvas
                racks={topology ? topology.racks : []}
                selectedRackId={selectedRackId}
                selectedSlotId={selectedSlot?.slot_id}
                onSelectSlot={handleSelectSlot}
                isTenant={true}
                tenantId={tenantId}
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
                <p className="text-12 text-ink-muted">Select a rack to inspect margins.</p>
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
            isTenant={true}
            tenantId={tenantId}
            nodeStatuses={nodeStatuses}
            escalationSlotIds={escalationSlotIds}
            telemetry={telemetry}
            isStale={wsStatus === 'stale'}
          />

          {/* Operational Secondary Panels: Assigned Racks & Selected Rack Summary */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <aside className="lg:col-span-4 space-y-4">
              <div className="border border-border rounded-lg bg-surface shadow-card overflow-hidden">
                <div className="px-4 py-3 bg-surface-sunken border-b border-border flex items-center justify-between">
                  <span className="text-12 font-semibold uppercase tracking-wider text-ink-2">
                    Assigned Racks
                  </span>
                  <span className="text-11 font-mono text-ink-muted">
                    {topology?.racks.length || 0} Racks
                  </span>
                </div>
                <div className="p-2 space-y-1">
                  {topology?.racks.map((rack) => {
                    const isSelected = selectedRackId === rack.rack_id;
                    const mySlotsInRack = rack.slots.filter((s) => s.tenant_id === tenantId);

                    return (
                      <div key={rack.rack_id} className="space-y-1">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedRackId(rack.rack_id);
                            if (mySlotsInRack.length > 0 && selectedRack?.rack_id !== rack.rack_id) {
                              handleSelectSlot(mySlotsInRack[0], rack);
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
                                {mySlotsInRack.length} bay{mySlotsInRack.length === 1 ? '' : 's'} allocated
                              </div>
                            </div>
                          </div>
                          <span className="text-11 font-mono text-ink-2 font-medium">
                            Row {rack.position.row}
                          </span>
                        </button>

                        {isSelected && (
                          <div className="ml-3 pl-2.5 border-l border-border/80 space-y-1 py-1" role="list" aria-label={`${rack.label} allocated bays`}>
                            {mySlotsInRack.map((slot) => {
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
                                  aria-label={`Select bay U${slot.u_start} (${slot.node_id || 'unlet'}) with status ${effectiveStatus}`}
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

              {/* Privacy Policy Callout */}
              <div className="p-4 rounded-lg border border-border bg-surface-sunken space-y-2 text-12">
                <span className="font-semibold text-ink block">Tenant Isolation Guarantee</span>
                <p className="text-ink-2 leading-relaxed text-11">
                  You receive full rack physical geometry so the facility layout renders accurately.
                  Neighbouring bays remain shielded with neutral hatch, no identifiers, and status UNKNOWN.
                </p>
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
                  <p className="text-12 text-ink-muted">Select a rack to inspect margins.</p>
                </Card>
              )}
            </main>
          </div>
        </div>
      )}

      {/* Bottom: Recent Activity for Tenant (Omitted on Racks-only page) */}
      {!onlyRacks && (
        <Card
          title="Your Telemetry Events"
          subtitle="Recent threshold triggers and change-point detections on your assigned nodes"
        >
          <DataTable
            columns={activityColumns}
            data={tenantActivityItems}
            keyExtractor={(item) => item.id}
            emptyState={
              <EmptyState
                icon={Activity}
                title="No Telemetry Events"
                description="Your hardware nodes are operating within normal thermal and vibration baselines."
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
        isTenant={true}
      />
    </div>
  );
};
