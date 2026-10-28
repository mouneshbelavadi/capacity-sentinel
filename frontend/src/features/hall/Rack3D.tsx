import React from 'react';
import { Edges, Html } from '@react-three/drei';
import { Rack, Slot, Status } from '../../api/contract';
import { Slot3D } from './Slot3D';
import { NodeStatusInfo } from '../../api/ws';
import { Server } from 'lucide-react';

const COLOR_CHASSIS = '#FAFBFC'; // --surface-sunken
const COLOR_FRAME = '#E8EAED'; // subtle frame structure
const COLOR_BORDER_STRONG = '#C4C7CC'; // --border-strong

interface Rack3DProps {
  rack: Rack;
  position: [number, number, number];
  selectedSlotId?: string | null;
  onSelectSlot: (slot: Slot, rack: Rack) => void;
  isTenant?: boolean;
  tenantId?: string | null;
  nodeStatuses?: Record<string, NodeStatusInfo>;
  escalationSlotIds?: string[];
}

export const Rack3D: React.FC<Rack3DProps> = ({
  rack,
  position,
  selectedSlotId,
  onSelectSlot,
  isTenant = false,
  tenantId = null,
  nodeStatuses = {},
  escalationSlotIds = [],
}) => {
  // Standard rack dimensions (in 3D units)
  const rackWidth = 2.4;
  const rackDepth = 3.0;
  const rackHeight = 8.0; // 42U total span
  const uScale = rackHeight / 42; // ~0.19 units per U

  const sortedSlots = [...rack.slots].sort((a, b) => a.u_start - b.u_start);

  return (
    <group position={position}>
      {/* Rack Chassis Cabinet - Light neutral box */}
      <mesh position={[0, rackHeight / 2, 0]}>
        <boxGeometry args={[rackWidth, rackHeight, rackDepth]} />
        <meshStandardMaterial
          color={COLOR_CHASSIS}
          roughness={0.8}
          metalness={0.05}
          transparent
          opacity={0.35} // Semitransparent chassis so internal bays and wiring are discernible
        />
        <Edges color={COLOR_BORDER_STRONG} threshold={20} lineWidth={1.5} />
      </mesh>

      {/* Structural Corner Posts (Vertical rails) */}
      {[-rackWidth / 2 + 0.05, rackWidth / 2 - 0.05].map((x, xi) =>
        [-rackDepth / 2 + 0.05, rackDepth / 2 - 0.05].map((z, zi) => (
          <mesh key={`post-${xi}-${zi}`} position={[x, rackHeight / 2, z]}>
            <boxGeometry args={[0.08, rackHeight, 0.08]} />
            <meshStandardMaterial color={COLOR_FRAME} roughness={0.5} />
          </mesh>
        ))
      )}

      {/* Rack Header Billboard / Label at the top */}
      <Html
        position={[0, rackHeight + 0.45, 0]}
        center
        distanceFactor={18}
        zIndexRange={[150, 0]}
      >
        <div className="pointer-events-none select-none flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface border border-border shadow-card text-12 font-semibold text-ink whitespace-nowrap">
          <Server size={14} strokeWidth={1.5} className="text-primary" />
          <span>{rack.label}</span>
          <span className="font-mono text-11 text-ink-muted">
            ({rack.rack_id})
          </span>
        </div>
      </Html>

      {/* Internal Slots */}
      {sortedSlots.map((slot) => {
        const isForeign = Boolean(
          isTenant &&
          (slot.tenant_id === null || (tenantId && slot.tenant_id !== tenantId)) &&
          slot.status === 'UNKNOWN'
        );

        const isSelected = selectedSlotId === slot.slot_id;
        const isEscalating = escalationSlotIds.includes(slot.slot_id);

        const liveNode = slot.node_id ? nodeStatuses[slot.node_id] : undefined;
        const isNodeOffline = liveNode?.status === 'offline';
        const effectiveStatus: Status = isNodeOffline ? 'OFFLINE' : slot.status;

        // Slot vertical position:
        // u_start is 1-indexed (1 to 42). Center of slot = (u_start - 1 + u_height / 2) * uScale
        const slotHeight = Math.max(slot.u_height * uScale - 0.04, 0.15);
        const slotY = (slot.u_start - 1 + slot.u_height / 2) * uScale;
        const slotWidth = rackWidth - 0.24;
        const slotDepth = rackDepth - 0.24;

        return (
          <Slot3D
            key={slot.slot_id}
            slot={slot}
            rackId={rack.rack_id}
            rackLabel={rack.label}
            position={[0, slotY, 0]}
            size={[slotWidth, slotHeight, slotDepth]}
            isSelected={isSelected}
            isForeign={isForeign}
            isEscalating={isEscalating}
            effectiveStatus={effectiveStatus}
            onSelect={(s) => onSelectSlot(s, rack)}
          />
        );
      })}
    </group>
  );
};
