import React, { useMemo } from 'react';
import { Edges, Html } from '@react-three/drei';
import { Rack, Slot, Status } from '../../api/contract';
import { Slot3D } from './Slot3D';
import { NodeStatusInfo } from '../../api/ws';
import { StatusBadge } from '../../design/StatusBadge';
import { CategoryTab, isSlotRelevantToCategory, TimelineHorizon, getPredictedSlotStatus } from './visualManagementTypes';
import { Server } from 'lucide-react';

const COLOR_CABINET = '#1E232A'; // Enterprise dark charcoal chassis frame
const COLOR_PLINTH = '#16191F'; // Plinth base & roof canopy
const COLOR_RAIL = '#475569'; // EIA-310 19-inch mounting rail
const COLOR_RAIL_NOTCH = '#94A3B8'; // U-marking notches
const COLOR_SIDE_INSET = '#13161B'; // Recessed side panel wall
const COLOR_BORDER_FRAME = '#334155'; // Edge definition line
const COLOR_CONTACT_SHADOW = '#0F172A'; // Ground contact shadow

interface UnoccupiedInterval {
  u_start: number;
  u_height: number;
}

/**
 * Standby Server Blade Item (Installed Enterprise Blade Unit)
 * Provides dense server blade hardware visual across rack bays with handles,
 * hot-swap drive caddies, power LEDs, and honest unprovisioned state on hover.
 */
const StandbyServerBladeItem: React.FC<{
  uStart: number;
  uHeight: number;
  uScale: number;
  rackWidth: number;
  rackDepth: number;
  rackLabel: string;
}> = ({ uStart, uHeight, uScale, rackWidth, rackDepth, rackLabel }) => {
  const [hovered, setHovered] = React.useState(false);
  const height = Math.max(uHeight * uScale - 0.03, 0.15);
  const posY = (uStart - 1 + uHeight / 2) * uScale;
  const width = rackWidth - 0.22;
  const depth = rackDepth - 0.28;
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const earWidth = 0.09;
  const earHeight = height * 0.94;
  const driveCount = uHeight >= 2 ? 6 : 4;
  const driveWidth = 0.16;
  const driveHeight = uHeight >= 2 ? height * 0.38 : height * 0.65;

  return (
    <group
      position={[0, posY, 0]}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => {
        setHovered(false);
      }}
    >
      {/* 1. Brushed Steel Chassis Body */}
      <mesh>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color="#181C23" roughness={0.55} metalness={0.35} />
        <Edges color={hovered ? '#38BDF8' : '#334155'} threshold={20} lineWidth={hovered ? 1.5 : 1} />
      </mesh>

      {/* 2. Faceplate Detailing */}
      <group position={[0, 0, halfDepth + 0.008]}>
        {/* Left Rack Ear & Stainless Handle */}
        <mesh position={[-halfWidth + earWidth / 2 + 0.01, 0, 0]}>
          <boxGeometry args={[earWidth, earHeight, 0.016]} />
          <meshStandardMaterial color="#94A3B8" roughness={0.3} metalness={0.7} />
        </mesh>
        <mesh position={[-halfWidth + earWidth / 2 + 0.01, 0, 0.018]}>
          <boxGeometry args={[0.022, earHeight * 0.65, 0.024]} />
          <meshStandardMaterial color="#E2E8F0" roughness={0.15} metalness={0.9} />
        </mesh>

        {/* Right Rack Ear & Stainless Handle */}
        <mesh position={[halfWidth - earWidth / 2 - 0.01, 0, 0]}>
          <boxGeometry args={[earWidth, earHeight, 0.016]} />
          <meshStandardMaterial color="#94A3B8" roughness={0.3} metalness={0.7} />
        </mesh>
        <mesh position={[halfWidth - earWidth / 2 - 0.01, 0, 0.018]}>
          <boxGeometry args={[0.022, earHeight * 0.65, 0.024]} />
          <meshStandardMaterial color="#E2E8F0" roughness={0.15} metalness={0.9} />
        </mesh>

        {/* Hot-Swap Drive Caddies */}
        <group position={[-halfWidth + earWidth + 0.06 + (driveCount * (driveWidth + 0.02)) / 2, 0, 0.004]}>
          {Array.from({ length: driveCount }).map((_, di) => {
            const driveX = (di - (driveCount - 1) / 2) * (driveWidth + 0.02);
            return (
              <group key={`std-drive-${di}`} position={[driveX, 0, 0]}>
                <mesh>
                  <boxGeometry args={[driveWidth, driveHeight, 0.01]} />
                  <meshStandardMaterial color="#21262D" roughness={0.7} metalness={0.3} />
                  <Edges color="#30363D" threshold={20} lineWidth={1} />
                </mesh>
                <mesh position={[0, -driveHeight / 2 + 0.02, 0.006]}>
                  <boxGeometry args={[driveWidth * 0.8, 0.015, 0.004]} />
                  <meshStandardMaterial color="#30363D" roughness={0.5} metalness={0.5} />
                </mesh>
                <mesh position={[driveWidth / 2 - 0.025, driveHeight / 2 - 0.025, 0.006]}>
                  <boxGeometry args={[0.015, 0.015, 0.005]} />
                  <meshBasicMaterial color="#10B981" />
                </mesh>
              </group>
            );
          })}
        </group>

        {/* Cooling Ventilation Grille */}
        <mesh position={[halfWidth - earWidth - 0.38, 0, 0.003]}>
          <planeGeometry args={[0.48, height * 0.55]} />
          <meshBasicMaterial color="#334155" wireframe />
        </mesh>

        {/* Subtle Green Illuminated Light Strip along Bottom */}
        <mesh position={[0, -height / 2 + 0.025, 0.008]}>
          <boxGeometry args={[width * 0.76, 0.025, 0.012]} />
          <meshBasicMaterial color="#00E676" />
        </mesh>

        {/* Power LED Indicator (Left of right ear) */}
        <mesh position={[halfWidth - earWidth - 0.06, 0.02, 0.01]}>
          <boxGeometry args={[0.03, 0.03, 0.02]} />
          <meshBasicMaterial color="#00E676" />
        </mesh>

        {/* Operational Status LED Indicator */}
        <mesh position={[halfWidth - earWidth - 0.02, 0.02, 0.01]}>
          <boxGeometry args={[0.035, 0.035, 0.02]} />
          <meshBasicMaterial color="#00E676" />
        </mesh>
      </group>

      {/* Honest Hover Tooltip */}
      {hovered && (
        <Html
          position={[0, height / 2 + 0.22, 0]}
          center
          distanceFactor={16}
          zIndexRange={[200, 0]}
        >
          <div className="pointer-events-none select-none bg-surface border border-border rounded-lg shadow-card p-2.5 text-11 text-ink min-w-[180px] whitespace-nowrap">
            <div className="font-semibold text-12 text-ink flex items-center justify-between gap-3 pb-1 border-b border-border">
              <span>{rackLabel}</span>
              <span className="font-mono text-ink-2 font-medium">
                U{uStart}–U{uStart + uHeight - 1} ({uHeight}U)
              </span>
            </div>
            <div className="pt-1 text-ink-2 text-11 flex justify-between">
              <span>Type:</span>
              <span className="font-medium text-ink">Standby Server Unit</span>
            </div>
            <div className="pt-1 border-t border-border/60 text-10 text-ink-muted flex justify-between">
              <span>Status:</span>
              <span className="font-mono font-semibold text-ok">Standby (Available Bay)</span>
            </div>
          </div>
        </Html>
      )}
    </group>
  );
};

interface Rack3DProps {
  rack: Rack;
  position: [number, number, number];
  selectedSlotId?: string | null;
  onSelectSlot: (slot: Slot, rack: Rack) => void;
  isTenant?: boolean;
  tenantId?: string | null;
  nodeStatuses?: Record<string, NodeStatusInfo>;
  escalationSlotIds?: string[];
  categoryFilter?: CategoryTab;
  statusFilter?: Status | null;
  horizon?: TimelineHorizon;
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
  categoryFilter = 'all',
  statusFilter = null,
  horizon = 'now',
}) => {
  // Standard 42U rack cabinet dimensions (in 3D units)
  const rackWidth = 2.4;
  const rackDepth = 3.1;
  const rackHeight = 8.0; // 42U total span
  const uScale = rackHeight / 42; // ~0.1905 units per U

  const sortedSlots = [...rack.slots].sort((a, b) => a.u_start - b.u_start);

  // Compute unoccupied U intervals between 1 and 42
  const unoccupiedIntervals: UnoccupiedInterval[] = useMemo(() => {
    const occupied = new Array(43).fill(false);
    for (const s of sortedSlots) {
      const end = s.u_start + s.u_height - 1;
      for (let u = s.u_start; u <= end; u++) {
        if (u >= 1 && u <= 42) occupied[u] = true;
      }
    }

    const intervals: UnoccupiedInterval[] = [];
    let currentStart: number | null = null;

    for (let u = 1; u <= 42; u++) {
      if (!occupied[u]) {
        if (currentStart === null) currentStart = u;
      } else {
        if (currentStart !== null) {
          intervals.push({ u_start: currentStart, u_height: u - currentStart });
          currentStart = null;
        }
      }
    }
    if (currentStart !== null) {
      intervals.push({ u_start: currentStart, u_height: 43 - currentStart });
    }

    return intervals;
  }, [sortedSlots]);

  // Break unoccupied intervals into 2U / 1U server units so the rack is fully populated with servers
  const standbyServers = useMemo(() => {
    const servers: { u_start: number; u_height: number; id: string }[] = [];
    for (const interval of unoccupiedIntervals) {
      let currentU = interval.u_start;
      let remaining = interval.u_height;
      while (remaining > 0) {
        const h = remaining >= 2 ? 2 : 1;
        servers.push({
          u_start: currentU,
          u_height: h,
          id: `${rack.rack_id}-standby-u${currentU}`,
        });
        currentU += h;
        remaining -= h;
      }
    }
    return servers;
  }, [unoccupiedIntervals, rack.rack_id]);

  // Compute worst operational (or predicted) status across rack slots
  const worstStatus: Status = useMemo(() => {
    let hasCrit = false;
    let hasWarn = false;
    let hasOffline = false;
    for (const s of rack.slots) {
      const liveNode = s.node_id ? nodeStatuses[s.node_id] : undefined;
      const baseSt = liveNode?.status === 'offline' ? 'OFFLINE' : s.status;
      const st = getPredictedSlotStatus(s, horizon, baseSt);

      if (st === 'CRIT') hasCrit = true;
      if (st === 'WARN') hasWarn = true;
      if (st === 'OFFLINE') hasOffline = true;
    }
    if (hasCrit) return 'CRIT';
    if (hasWarn) return 'WARN';
    if (hasOffline) return 'OFFLINE';
    return 'OK';
  }, [rack.slots, nodeStatuses, horizon]);

  const isPredictive = horizon !== 'now';

  return (
    <group position={position}>
      {/* 1. Ground Contact Shadow Plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
        <planeGeometry args={[rackWidth + 0.8, rackDepth + 0.8]} />
        <meshBasicMaterial color={COLOR_CONTACT_SHADOW} transparent opacity={0.22} />
      </mesh>

      {/* 2. Heavy-duty Plinth Base Pedestal */}
      <mesh position={[0, 0.08, 0]}>
        <boxGeometry args={[rackWidth + 0.14, 0.16, rackDepth + 0.14]} />
        <meshStandardMaterial color={COLOR_PLINTH} roughness={0.6} metalness={0.4} />
        <Edges color={COLOR_BORDER_FRAME} threshold={20} lineWidth={1.5} />
      </mesh>

      {/* Plinth Leveling Feet (4 corners) */}
      {[-rackWidth / 2 + 0.08, rackWidth / 2 - 0.08].map((lx, lxi) =>
        [-rackDepth / 2 + 0.08, rackDepth / 2 - 0.08].map((lz, lzi) => (
          <mesh key={`foot-${lxi}-${lzi}`} position={[lx, 0.03, lz]}>
            <boxGeometry args={[0.12, 0.06, 0.12]} />
            <meshStandardMaterial color="#64748B" roughness={0.3} metalness={0.7} />
          </mesh>
        ))
      )}

      {/* 3. Top Roof Canopy Enclosure with Cable Entry Port */}
      <mesh position={[0, rackHeight + 0.08, 0]}>
        <boxGeometry args={[rackWidth + 0.14, 0.16, rackDepth + 0.14]} />
        <meshStandardMaterial color={COLOR_PLINTH} roughness={0.6} metalness={0.4} />
        <Edges color={COLOR_BORDER_FRAME} threshold={20} lineWidth={1.5} />
      </mesh>

      {/* Dual Exhaust Fan Grilles on Canopy Top */}
      {[-0.45, 0.45].map((fanX, fi) => (
        <group key={`fan-${fi}`} position={[fanX, rackHeight + 0.165, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.26, 16]} />
            <meshBasicMaterial color="#334155" wireframe />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.24, 0.28, 16]} />
            <meshStandardMaterial color="#64748B" roughness={0.4} metalness={0.6} />
          </mesh>
        </group>
      ))}

      {/* Top Cable Entry Gland Collar (connects to overhead raceway) */}
      <mesh position={[0, rackHeight + 0.17, -0.6]}>
        <boxGeometry args={[0.34, 0.04, 0.34]} />
        <meshStandardMaterial color="#475569" roughness={0.5} metalness={0.5} />
      </mesh>

      {/* 4. Structural Corner Uprights (4 heavy posts) */}
      {[-rackWidth / 2 + 0.05, rackWidth / 2 - 0.05].map((px, pxi) =>
        [-rackDepth / 2 + 0.05, rackDepth / 2 - 0.05].map((pz, pzi) => (
          <mesh key={`post-${pxi}-${pzi}`} position={[px, rackHeight / 2, pz]}>
            <boxGeometry args={[0.1, rackHeight, 0.1]} />
            <meshStandardMaterial color={COLOR_CABINET} roughness={0.5} metalness={0.3} />
            <Edges color={COLOR_BORDER_FRAME} threshold={20} lineWidth={1} />
          </mesh>
        ))
      )}

      {/* 5. Front EIA-310 19" Vertical Equipment Mounting Rails */}
      {[-rackWidth / 2 + 0.11, rackWidth / 2 - 0.11].map((rx, ri) => (
        <group key={`rail-${ri}`} position={[rx, rackHeight / 2, rackDepth / 2 - 0.12]}>
          <mesh>
            <boxGeometry args={[0.04, rackHeight, 0.06]} />
            <meshStandardMaterial color={COLOR_RAIL} roughness={0.4} metalness={0.6} />
            <Edges color="#64748B" threshold={20} lineWidth={1} />
          </mesh>
          {/* U-Height Tick Markers (Every 10U) */}
          {[10, 20, 30, 40].map((u) => (
            <mesh key={`u-tick-${u}`} position={[0, (u - 21) * uScale, 0.032]}>
              <boxGeometry args={[0.035, 0.015, 0.008]} />
              <meshBasicMaterial color={COLOR_RAIL_NOTCH} />
            </mesh>
          ))}
        </group>
      ))}

      {/* 6. Cabinet Side Panels (Left & Right Recessed Metal Walls) */}
      {/* Left Wall */}
      <group position={[-rackWidth / 2 + 0.01, rackHeight / 2, 0]}>
        <mesh>
          <boxGeometry args={[0.02, rackHeight * 0.96, rackDepth * 0.94]} />
          <meshStandardMaterial color={COLOR_CABINET} roughness={0.7} metalness={0.2} />
          <Edges color={COLOR_BORDER_FRAME} threshold={30} lineWidth={1} />
        </mesh>
        {/* Recessed Inset Panel */}
        <mesh position={[-0.005, 0, 0]}>
          <boxGeometry args={[0.01, rackHeight * 0.88, rackDepth * 0.84]} />
          <meshStandardMaterial color={COLOR_SIDE_INSET} roughness={0.8} metalness={0.15} />
        </mesh>
      </group>

      {/* Right Wall */}
      <group position={[rackWidth / 2 - 0.01, rackHeight / 2, 0]}>
        <mesh>
          <boxGeometry args={[0.02, rackHeight * 0.96, rackDepth * 0.94]} />
          <meshStandardMaterial color={COLOR_CABINET} roughness={0.7} metalness={0.2} />
          <Edges color={COLOR_BORDER_FRAME} threshold={30} lineWidth={1} />
        </mesh>
        {/* Recessed Inset Panel */}
        <mesh position={[0.005, 0, 0]}>
          <boxGeometry args={[0.01, rackHeight * 0.88, rackDepth * 0.84]} />
          <meshStandardMaterial color={COLOR_SIDE_INSET} roughness={0.8} metalness={0.15} />
        </mesh>
      </group>

      {/* 7. Rear Perforated Exhaust Door */}
      <group position={[0, rackHeight / 2, -rackDepth / 2 + 0.02]}>
        <mesh>
          <planeGeometry args={[rackWidth - 0.2, rackHeight * 0.94]} />
          <meshBasicMaterial color="#1E293B" wireframe />
        </mesh>
      </group>

      {/* 8. Floating Billboard / Header Label above Rack */}
      <Html
        position={[0, rackHeight + 0.55, 0]}
        center
        distanceFactor={18}
        zIndexRange={[150, 0]}
      >
        <div className="pointer-events-none select-none flex items-center gap-2 px-2.5 py-1 rounded bg-surface border border-border shadow-card text-12 font-semibold text-ink whitespace-nowrap">
          <Server size={14} strokeWidth={1.5} className="text-primary" />
          <span>{rack.label}</span>
          <span className="font-mono text-11 text-ink-muted">
            ({rack.rack_id})
          </span>
          <StatusBadge status={worstStatus} size="sm" />
          {isPredictive && (
            <span className="text-10 font-mono text-ink-2 bg-surface-sunken px-1.5 py-0.5 rounded border border-border">
              {horizon}
            </span>
          )}
        </div>
      </Html>

      {/* 9. Standby Server Blade Units (Filling the Rack with Enterprise Hardware) */}
      {standbyServers.map((server) => (
        <StandbyServerBladeItem
          key={server.id}
          uStart={server.u_start}
          uHeight={server.u_height}
          uScale={uScale}
          rackWidth={rackWidth}
          rackDepth={rackDepth}
          rackLabel={rack.label}
        />
      ))}

      {/* 10. Monitored Topology Server Blades / Slots */}
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
        const baseStatus: Status = isNodeOffline ? 'OFFLINE' : slot.status;

        // Apply forecast projection if in predictive horizon
        const effectiveStatus: Status = getPredictedSlotStatus(slot, horizon, baseStatus);

        // Check if slot matches category filter & status filter
        const matchesCategory = isSlotRelevantToCategory(slot, categoryFilter);
        const matchesStatus = !statusFilter || effectiveStatus === statusFilter;
        const isDimmed = !matchesCategory || !matchesStatus;

        // Slot vertical position:
        const slotHeight = Math.max(slot.u_height * uScale - 0.03, 0.15);
        const slotY = (slot.u_start - 1 + slot.u_height / 2) * uScale;
        const slotWidth = rackWidth - 0.22;
        const slotDepth = rackDepth - 0.28;

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
            isDimmed={isDimmed}
            effectiveStatus={effectiveStatus}
            onSelect={(s) => onSelectSlot(s, rack)}
            horizon={horizon}
          />
        );
      })}
    </group>
  );
};
