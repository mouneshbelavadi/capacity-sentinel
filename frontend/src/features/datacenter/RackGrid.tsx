import React from 'react';
import { Rack, Slot, Status } from '../../api/contract';
import { StatusBadge } from '../../design/StatusBadge';
import { NodeStatusInfo, TelemetryReading } from '../../api/ws';
import { Server, Lock, WifiOff } from 'lucide-react';

export interface RackGridProps {
  racks: Rack[];
  selectedRackId?: string | null;
  selectedSlotId?: string | null;
  onSelectSlot: (slot: Slot, rack: Rack) => void;
  isTenant?: boolean;
  tenantId?: string | null;
  className?: string;
  nodeStatuses?: Record<string, NodeStatusInfo>;
  escalationSlotIds?: string[];
  telemetryByNodeMetric?: Record<string, TelemetryReading>;
  isStale?: boolean;
}

export const RackGrid: React.FC<RackGridProps> = ({
  racks,
  selectedRackId,
  selectedSlotId,
  onSelectSlot,
  isTenant = false,
  tenantId = null,
  className = '',
  nodeStatuses = {},
  escalationSlotIds = [],
  isStale = false,
}) => {
  // If no racks to display
  if (!racks || racks.length === 0) {
    return (
      <div className="border border-border rounded-lg p-8 text-center bg-surface">
        <Server size={32} strokeWidth={1.5} className="mx-auto text-ink-muted mb-2" />
        <p className="text-13 text-ink-2">No rack topology available for this view.</p>
      </div>
    );
  }

  // Filter if selectedRackId is explicitly passed
  const visibleRacks = selectedRackId
    ? racks.filter((r) => r.rack_id === selectedRackId)
    : racks;

  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 gap-6 ${className}`} data-testid="rack-grid">
      {visibleRacks.map((rack) => {
        // Vertical slot strip sorted by U position descending (top of rack down to bottom)
        const sortedSlots = [...rack.slots].sort((a, b) => b.u_start - a.u_start);

        return (
          <div
            key={rack.rack_id}
            className="border border-border rounded-lg bg-surface shadow-card flex flex-col overflow-hidden"
            data-testid={`rack-panel-${rack.rack_id}`}
          >
            {/* Rack Header */}
            <div className="px-4 py-3 border-b border-border bg-surface-sunken flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Server size={18} strokeWidth={1.5} className="text-primary" />
                <h3 className="text-13 font-semibold text-ink">{rack.label}</h3>
                <span className="text-11 font-mono text-ink-muted">
                  ({rack.rack_id})
                </span>
              </div>
              <span className="text-11 font-mono text-ink-2">
                Row {rack.position.row}, Col {rack.position.col}
              </span>
            </div>

            {/* Rack Cabinet Interior (Slot Strip) */}
            <div className="p-4 flex-1 flex flex-col gap-2.5 bg-surface">
              {/* Rack Top Indicator */}
              <div className="flex items-center justify-between text-11 text-ink-muted px-1 font-mono uppercase">
                <span>Top (42U)</span>
                <span>{sortedSlots.length} bays assigned</span>
              </div>

              {/* Slot Strip */}
              <div className="flex flex-col gap-2 border border-border rounded p-2 bg-surface-sunken min-h-[320px]">
                {sortedSlots.map((slot) => {
                  // Foreign slot condition for tenant scope per shared/tenant-isolation.md §4:
                  const isForeign =
                    isTenant &&
                    (slot.tenant_id === null || (tenantId && slot.tenant_id !== tenantId)) &&
                    slot.status === 'UNKNOWN';

                  const isSelected = selectedSlotId === slot.slot_id;
                  const isEscalating = escalationSlotIds.includes(slot.slot_id);
                  const uRange = `U${slot.u_start}–U${slot.u_start + slot.u_height - 1} (${slot.u_height}U)`;

                  // Live node status check per phase-3-realtime.md §6
                  const liveNode = slot.node_id ? nodeStatuses[slot.node_id] : undefined;
                  const isNodeOffline = liveNode?.status === 'offline';
                  const effectiveStatus: Status = isNodeOffline ? 'OFFLINE' : slot.status;

                  if (isForeign) {
                    return (
                      <div
                        key={slot.slot_id}
                        role="region"
                        aria-label={`Slot ${slot.slot_id} - Not your slot`}
                        tabIndex={0}
                        onClick={() => onSelectSlot(slot, rack)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSelectSlot(slot, rack);
                          }
                        }}
                        className={`p-3 rounded border border-dashed border-border hatch-foreign cursor-pointer transition-colors relative flex items-center justify-between min-h-[58px] ${
                          isSelected ? 'ring-2 ring-primary border-primary' : 'hover:border-ink-muted'
                        }`}
                        data-testid={`slot-${slot.slot_id}-foreign`}
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono text-11 font-semibold text-ink-muted tabular-nums">
                            {uRange}
                          </span>
                          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-surface border border-border text-ink-2">
                            <Lock size={12} strokeWidth={1.5} className="text-ink-muted" />
                            <span className="text-11 font-semibold text-ink">
                              Not your slot
                            </span>
                          </div>
                        </div>
                        <span className="text-11 text-ink-muted font-mono">
                          Shielded
                        </span>
                      </div>
                    );
                  }

                  // Owned or Operator-visible Slot
                  return (
                    <div
                      key={slot.slot_id}
                      role="button"
                      aria-label={`Slot ${slot.slot_id}: ${slot.tenant_label || 'Unassigned'} - Status: ${effectiveStatus}`}
                      tabIndex={0}
                      onClick={() => onSelectSlot(slot, rack)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectSlot(slot, rack);
                        }
                      }}
                      className={`p-3 rounded border bg-surface transition-all cursor-pointer flex items-center justify-between min-h-[58px] ${
                        isEscalating ? 'pulse-escalation' : ''
                      } ${
                        isSelected
                          ? 'border-primary ring-2 ring-primary shadow-sm bg-primary-weak/10'
                          : 'border-border hover:border-ink-muted hover:bg-surface-hover'
                      } ${isStale ? 'opacity-80' : ''}`}
                      data-testid={`slot-${slot.slot_id}`}
                    >
                      {/* Left: U Range & Tenant */}
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-11 font-semibold text-ink-2 tabular-nums">
                            {uRange}
                          </span>
                          <span className="text-12 font-medium text-ink">
                            {slot.tenant_label || 'Unassigned'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-11 text-ink-muted font-mono">
                          <span>{slot.slot_id}</span>
                          {slot.node_id && (
                            <>
                              <span>•</span>
                              <span className="text-primary font-mono">{slot.node_id}</span>
                            </>
                          )}
                          {isNodeOffline && (
                            <span className="inline-flex items-center gap-1 text-critical font-medium">
                              <WifiOff size={11} strokeWidth={1.5} />
                              <span>Offline since {liveNode?.offlineSince ? new Date(liveNode.offlineSince).toLocaleTimeString() : 'now'}</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Right: Status Badge */}
                      <div className="flex items-center gap-2">
                        <StatusBadge status={effectiveStatus} size="sm" />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Rack Bottom Indicator */}
              <div className="flex items-center justify-between text-11 text-ink-muted px-1 font-mono uppercase">
                <span>Bottom (1U)</span>
                <span>Power Bus A+B</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
