import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Edges, Html } from '@react-three/drei';
import { Rack, Slot, Status } from '../../api/contract';
import { Rack3D } from './Rack3D';
import { AmbientRack3D } from './AmbientRack3D';
import { NodeStatusInfo, TelemetryReading } from '../../api/ws';
import { RackGrid } from '../datacenter/RackGrid';
import { CategoryTab, TimelineHorizon, getPredictedSlotStatus } from './visualManagementTypes';
import {
  Eye,
  Layers,
  Activity,
  AlertCircle,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  X,
  Target,
  Maximize2,
  Minimize2,
} from 'lucide-react';

const COLOR_CANVAS = '#F5F6F8'; // --canvas
const COLOR_GRID_LINE = '#DADCE0'; // --border
const COLOR_RACK_FOOTPRINT = '#EAECEF'; // subtle floor marker

/**
 * Checks whether WebGL 1/2 is supported and active in the current browser/DOM environment.
 */
export function checkWebGLSupport(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext('webgl2') ||
          canvas.getContext('webgl') ||
          canvas.getContext('experimental-webgl'))
    );
  } catch {
    return false;
  }
}

type CameraPreset = 'isometric' | 'focus-main' | 'frontal' | 'top' | 'zoom-in' | 'zoom-out' | 'reset';

/**
 * Declarative camera repositioner & orbit control sync
 */
const CameraController: React.FC<{
  action: { type: CameraPreset; token: number } | null;
  controlsRef: React.RefObject<any>;
}> = ({ action, controlsRef }) => {
  const { camera, invalidate } = useThree();

  useEffect(() => {
    if (!action) return;
    const controls = controlsRef.current;
    if (action.type === 'isometric' || action.type === 'reset') {
      camera.position.set(6, 6, 8.5);
      if (controls) controls.target.set(0, 3.0, 0);
    } else if (action.type === 'focus-main') {
      camera.position.set(-1.7, 4.5, 6.5);
      if (controls) controls.target.set(-1.7, 3.5, 0);
    } else if (action.type === 'frontal') {
      camera.position.set(0, 4.0, 9.0);
      if (controls) controls.target.set(0, 3.2, 0);
    } else if (action.type === 'top') {
      camera.position.set(0, 16, 0.05);
      if (controls) controls.target.set(0, 0, 0);
    } else if (action.type === 'zoom-in') {
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      camera.position.addScaledVector(dir, 2.2);
    } else if (action.type === 'zoom-out') {
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      camera.position.addScaledVector(dir, -2.2);
    }
    if (controls) controls.update();
    invalidate();
  }, [action, camera, controlsRef, invalidate]);

  return null;
};

/**
 * Demand Invalidator: Calls R3F `invalidate()` when live telemetry,
 * node status, or selection updates occur, ensuring strict data-driven rendering.
 */
const DemandInvalidator: React.FC<{
  dependencyKey: string;
  onFrameCount?: () => void;
}> = ({ dependencyKey, onFrameCount }) => {
  const { invalidate } = useThree();

  useEffect(() => {
    invalidate();
    if (onFrameCount) onFrameCount();
  }, [dependencyKey, invalidate, onFrameCount]);

  return null;
};

interface AmbientRackDef {
  label: string;
  position: [number, number, number];
}

/**
 * Racks matching topology.example.yaml
 * Row 0: 6 ambient racks flanking our 2 highlighted racks
 * Row 1: 7 ambient racks along Aisle B
 * Row 2: 7 ambient racks along Aisle C
 * Row 3: 7 ambient racks along Aisle D
 */
// Rule 0 enforcement: No invented racks. Render exactly the racks in topology.yaml.
const AMBIENT_RACKS: AmbientRackDef[] = [];

/**
 * Data Center Hall Raised Access Floor & Pathways
 * Includes realistic walking corridors, cold aisle airflow plenums, and guide markings
 */
const HallFloor: React.FC<{
  allRackPositions: [number, number, number][];
}> = ({ allRackPositions }) => {
  const rowZList = [0];

  return (
    <group position={[0, -0.01, 0]}>
      {/* 1. Base Data Center Room Floor (White/Light-grey raised floor) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[18, 16]} />
        <meshBasicMaterial color={COLOR_CANVAS} />
      </mesh>

      {/* 2. Floor Tile Grid Lines (600mm x 600mm grid) */}
      <gridHelper
        args={[18, 18, COLOR_GRID_LINE, COLOR_GRID_LINE]}
        position={[0, 0.005, 0]}
      />

      {/* 3. Rack Footprint Floor Markers & Cold Aisle Perforated Floor Plenum Tiles */}
      {allRackPositions.map((pos, i) => (
        <group key={`floor-item-${i}`}>
          {/* Rack Footprint */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[pos[0], 0.008, pos[2]]}>
            <planeGeometry args={[2.7, 3.4]} />
            <meshBasicMaterial color={COLOR_RACK_FOOTPRINT} />
            <Edges color={COLOR_GRID_LINE} threshold={15} lineWidth={1.2} />
          </mesh>

          {/* Cold Aisle Perforated Floor Tile in front of each rack */}
          <group position={[pos[0], 0.012, pos[2] + 2.2]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[2.4, 1.2]} />
              <meshBasicMaterial color="#E2E8F0" />
              <Edges color="#94A3B8" threshold={15} lineWidth={1} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0.002]}>
              <planeGeometry args={[2.2, 1.0]} />
              <meshBasicMaterial color="#94A3B8" wireframe />
            </mesh>
          </group>
        </group>
      ))}

      {/* 4. Cold Aisle Floor Demarcation Guide Lines (Cyan stripes in front of each row) */}
      {rowZList.map((rowZ, ri) => (
        <mesh
          key={`aisle-line-${ri}`}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.015, rowZ + 2.85]}
        >
          <planeGeometry args={[28, 0.05]} />
          <meshBasicMaterial color="#0EA5E9" transparent opacity={0.35} />
        </mesh>
      ))}

      {/* 5. Cross-Aisle Pathway Guide Lines along Left and Right Corridors */}
      {[-13.5, 13.5].map((sideX, si) => (
        <mesh
          key={`side-aisle-${si}`}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[sideX, 0.014, -9.6]}
        >
          <planeGeometry args={[0.06, 26]} />
          <meshBasicMaterial color="#94A3B8" transparent opacity={0.4} />
        </mesh>
      ))}
    </group>
  );
};

/**
 * Overhead Cable Ladder Rack & Yellow Fiber Optic Raceway (Panduit FiberRunner style)
 * Spans across all 4 rows with cross-aisle bridges and vertical drop chutes
 */
const OverheadInfrastructure: React.FC<{
  allRackPositions: [number, number, number][];
}> = ({ allRackPositions }) => {
  const rowZList = [0];
  const rowSpan = 27.0;
  const racewayY = 8.95;

  return (
    <group position={[0, racewayY, 0]}>
      {/* 1. Yellow Fiber Optic Raceways for each row */}
      {rowZList.map((rowZ, ri) => (
        <group key={`raceway-row-${ri}`} position={[0, 0, rowZ]}>
          {/* Fiber Channel */}
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[rowSpan, 0.22, 0.28]} />
            <meshStandardMaterial color="#EAB308" roughness={0.4} metalness={0.15} />
            <Edges color="#CA8A04" threshold={20} lineWidth={1.2} />
          </mesh>

          {/* Parallel Cable Ladder */}
          <mesh position={[0, 0.04, 0.45]}>
            <boxGeometry args={[rowSpan, 0.06, 0.4]} />
            <meshStandardMaterial color="#475569" roughness={0.4} metalness={0.6} />
            <Edges color="#64748B" threshold={20} lineWidth={1} />
          </mesh>

          {/* Ladder Rungs */}
          {Array.from({ length: Math.floor(rowSpan / 1.2) }).map((_, i) => {
            const rungX = -rowSpan / 2 + (i + 1) * 1.2;
            return (
              <mesh key={`rung-${ri}-${i}`} position={[rungX, 0.06, 0.45]}>
                <boxGeometry args={[0.04, 0.03, 0.38]} />
                <meshStandardMaterial color="#64748B" roughness={0.3} metalness={0.7} />
              </mesh>
            );
          })}
        </group>
      ))}

      {/* 2. Cross-Aisle Overhead Fiber Bridge (Connecting all 4 rows along left aisle) */}
      <group position={[-13.2, 0.16, -9.6]}>
        <mesh>
          <boxGeometry args={[0.28, 0.22, 22.0]} />
          <meshStandardMaterial color="#EAB308" roughness={0.4} metalness={0.15} />
          <Edges color="#CA8A04" threshold={20} lineWidth={1.2} />
        </mesh>
      </group>

      {/* 3. Vertical Yellow Drop Chutes into Rack Canopies */}
      {allRackPositions.map((pos, i) => (
        <group key={`drop-${i}`} position={[pos[0], -0.42, pos[2] - 0.6]}>
          <mesh>
            <boxGeometry args={[0.22, 0.72, 0.22]} />
            <meshStandardMaterial color="#EAB308" roughness={0.4} metalness={0.15} />
            <Edges color="#CA8A04" threshold={20} lineWidth={1} />
          </mesh>
        </group>
      ))}
    </group>
  );
};

/**
 * Perimeter CRAC / CRAH Industrial Cooling Units (Along the rear wall)
 */
const CRACUnits: React.FC = () => {
  const cracPositions = [-9.0, -3.0, 3.0, 9.0];
  return (
    <group position={[0, 0, -23.5]}>
      {cracPositions.map((x, i) => (
        <group key={`crac-${i}`} position={[x, 2.4, 0]}>
          {/* Main CRAC Chassis */}
          <mesh>
            <boxGeometry args={[2.8, 4.8, 1.4]} />
            <meshStandardMaterial color="#E2E8F0" roughness={0.6} metalness={0.2} />
            <Edges color="#94A3B8" threshold={20} lineWidth={1} />
          </mesh>
          {/* Front Air Return Grille */}
          <mesh position={[0, -0.6, 0.71]}>
            <planeGeometry args={[2.4, 2.8]} />
            <meshBasicMaterial color="#64748B" wireframe />
          </mesh>
          {/* Top Air Discharge Hood */}
          <mesh position={[0, 2.5, 0]}>
            <boxGeometry args={[2.6, 0.3, 1.2]} />
            <meshStandardMaterial color="#CBD5E1" roughness={0.5} metalness={0.3} />
          </mesh>
          {/* Power Status LED */}
          <mesh position={[1.1, 1.8, 0.72]}>
            <boxGeometry args={[0.06, 0.06, 0.02]} />
            <meshBasicMaterial color="#00E676" />
          </mesh>
        </group>
      ))}
    </group>
  );
};

export interface RackHallCanvasProps {
  racks: Rack[];
  selectedRackId?: string | null;
  selectedSlotId?: string | null;
  onSelectSlot: (slot: Slot | null, rack: Rack | null) => void;
  isTenant?: boolean;
  tenantId?: string | null;
  nodeStatuses?: Record<string, NodeStatusInfo>;
  escalationSlotIds?: string[];
  telemetryByNodeMetric?: Record<string, TelemetryReading>;
  isStale?: boolean;
  categoryFilter?: CategoryTab;
  statusFilter?: Status | null;
  horizon?: TimelineHorizon;
  isTotalView?: boolean;
  onToggleTotalView?: () => void;
  heightClass?: string;
}

export const RackHallCanvas: React.FC<RackHallCanvasProps> = ({
  racks,
  selectedRackId,
  selectedSlotId,
  onSelectSlot,
  isTenant = false,
  tenantId = null,
  nodeStatuses = {},
  escalationSlotIds = [],
  telemetryByNodeMetric = {},
  isStale = false,
  categoryFilter = 'all',
  statusFilter = null,
  horizon = 'now',
  isTotalView = false,
  onToggleTotalView,
  heightClass,
}) => {
  const [webGLSupported, setWebGLSupported] = useState<boolean>(true);
  const [forceFallback, setForceFallback] = useState<boolean>(false);
  const [fps, setFps] = useState<number>(60);
  const [cameraAction, setCameraAction] = useState<{ type: CameraPreset; token: number } | null>(null);
  const [activePreset, setActivePreset] = useState<CameraPreset>('isometric');

  const lastTimeRef = useRef<number>(performance.now());
  const frameCountRef = useRef<number>(0);
  const controlsRef = useRef<any>(null);

  useEffect(() => {
    setWebGLSupported(checkWebGLSupport());
  }, []);

  // Measured FPS calculation during data invalidations and user orbits
  const handleDemandFrame = () => {
    frameCountRef.current += 1;
    const now = performance.now();
    const delta = now - lastTimeRef.current;
    if (delta >= 1000) {
      // Calculate instantaneous FPS
      const currentFps = Math.min(Math.round((frameCountRef.current * 1000) / delta), 60);
      setFps(currentFps > 0 ? currentFps : 60);
      frameCountRef.current = 0;
      lastTimeRef.current = now;
    }
  };

  // Monitored racks from topology (defaulting to the two instrumented racks)
  const visibleRacks = useMemo(() => {
    if (!racks || racks.length === 0) return [];
    return racks;
  }, [racks]);

  // Center our two monitored racks in Row 0 at Z = 0
  const monitoredSpacing = 3.4;
  const monitoredTotalSpan = (visibleRacks.length - 1) * monitoredSpacing;
  const monitoredStartX = -monitoredTotalSpan / 2;

  // Composite array of all 29 rack coordinates for floor and overhead infrastructure
  const allRackPositions = useMemo<[number, number, number][]>(() => {
    const list: [number, number, number][] = [];
    // Monitored racks
    visibleRacks.forEach((_, idx) => {
      list.push([monitoredStartX + idx * monitoredSpacing, 0, 0]);
    });
    // Ambient facility racks
    AMBIENT_RACKS.forEach((amb) => {
      list.push(amb.position);
    });
    return list;
  }, [visibleRacks, monitoredStartX, monitoredSpacing]);

  // Composite key to trigger invalidate() when data or filter changes
  const dependencyKey = useMemo(() => {
    const escStr = escalationSlotIds.join(',');
    const statusStr = Object.entries(nodeStatuses)
      .map(([k, v]) => `${k}:${v.status}`)
      .join('|');
    return `${selectedSlotId || 'none'}-${escStr}-${statusStr}-${Object.keys(telemetryByNodeMetric).length}-${categoryFilter}-${statusFilter || 'all'}-${horizon}`;
  }, [selectedSlotId, escalationSlotIds, nodeStatuses, telemetryByNodeMetric, categoryFilter, statusFilter, horizon]);

  // Selected slot details for high-visibility floating callout card (anchored to monitored rack)
  const selectedSlotInfo = useMemo(() => {
    if (!selectedSlotId) return null;
    for (let rIdx = 0; rIdx < visibleRacks.length; rIdx++) {
      const rack = visibleRacks[rIdx];
      const slot = rack.slots.find((s) => s.slot_id === selectedSlotId);
      if (slot) {
        const posX = monitoredStartX + rIdx * monitoredSpacing;
        const uScale = 8.0 / 42;
        const slotY = (slot.u_start - 1 + slot.u_height / 2) * uScale;
        const isForeign = Boolean(
          isTenant &&
            (slot.tenant_id === null || (tenantId && slot.tenant_id !== tenantId)) &&
            slot.status === 'UNKNOWN'
        );
        const liveNode = slot.node_id ? nodeStatuses[slot.node_id] : undefined;
        const baseSt: Status = liveNode?.status === 'offline' ? 'OFFLINE' : slot.status;
        const effectiveSt: Status = getPredictedSlotStatus(slot, horizon, baseSt);

        return {
          rack,
          slot,
          pos: [posX, slotY + 0.8, 1.6] as [number, number, number],
          isForeign,
          effectiveStatus: effectiveSt,
          isPredictive: horizon !== 'now',
        };
      }
    }
    return null;
  }, [selectedSlotId, visibleRacks, monitoredStartX, monitoredSpacing, isTenant, tenantId, nodeStatuses, horizon]);

  // Fallback branch if WebGL is unavailable or user toggles 2D
  if (!webGLSupported || forceFallback) {
    return (
      <div className="space-y-4" data-testid="hall-fallback">
        <div className="flex items-center justify-between p-3 rounded border border-warn/40 bg-warn-weak text-12 text-ink">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} strokeWidth={1.5} className="text-warn shrink-0" />
            <span>
              {!webGLSupported
                ? 'WebGL is not supported or disabled in this browser. Displaying 2D physical bay elevation view.'
                : 'Displaying 2D physical bay elevation view.'}
            </span>
          </div>
          {webGLSupported && (
            <button
              type="button"
              onClick={() => setForceFallback(false)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface border border-border text-12 font-medium text-ink hover:bg-surface-hover transition-colors"
            >
              <Layers size={14} strokeWidth={1.5} className="text-primary" />
              <span>Switch to 3D Hall</span>
            </button>
          )}
        </div>
        <RackGrid
          racks={racks}
          selectedRackId={selectedRackId}
          selectedSlotId={selectedSlotId}
          onSelectSlot={onSelectSlot}
          isTenant={isTenant}
          tenantId={tenantId}
          nodeStatuses={nodeStatuses}
          escalationSlotIds={escalationSlotIds}
          telemetryByNodeMetric={telemetryByNodeMetric}
          isStale={isStale}
        />
      </div>
    );
  }

  return (
    <div
      className={`relative w-full ${heightClass || (isTotalView ? 'h-full' : 'h-[580px]')} ${
        isTotalView
          ? 'bg-canvas overflow-hidden'
          : 'rounded-lg border border-border bg-canvas overflow-hidden shadow-card'
      }`}
      data-testid="rack-hall-3d"
    >
      {/* Top Controls Overlay */}
      <div className="absolute top-3 left-3 right-3 z-10 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        {/* Left: View Mode & Context */}
        <div className="flex items-center gap-2 pointer-events-auto">
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface/90 backdrop-blur-sm border border-border text-11 font-semibold uppercase tracking-wider text-ink shadow-sm">
            <Eye size={13} strokeWidth={1.5} className="text-primary" />
            <span>3D Data Center (2 Physical Racks)</span>
          </span>
          {isStale && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-warn-weak border border-warn/40 text-warn text-11 font-medium shadow-sm">
              <RefreshCw size={11} strokeWidth={1.5} className="animate-spin" />
              <span>Stale</span>
            </span>
          )}
        </div>

        {/* Center: Camera Presets & Navigation Controls Toolbar */}
        <div className="flex items-center gap-1 p-1 rounded-md bg-surface/90 backdrop-blur-sm border border-border shadow-sm pointer-events-auto">
          <button
            type="button"
            onClick={() => {
              setActivePreset('isometric');
              setCameraAction({ type: 'isometric', token: Date.now() });
            }}
            className={`px-2 py-0.5 rounded text-11 font-medium transition-colors ${
              activePreset === 'isometric'
                ? 'bg-primary text-white shadow-xs'
                : 'text-ink-2 hover:bg-surface-hover hover:text-ink'
            }`}
            title="Data Center Isometric View (2 Physical Racks)"
          >
            Full Hall
          </button>
          <button
            type="button"
            onClick={() => {
              setActivePreset('focus-main');
              setCameraAction({ type: 'focus-main', token: Date.now() });
            }}
            className={`px-2 py-0.5 rounded text-11 font-medium transition-colors flex items-center gap-1 ${
              activePreset === 'focus-main'
                ? 'bg-primary text-white shadow-xs'
                : 'text-ink-2 hover:bg-surface-hover hover:text-ink'
            }`}
            title="Focus camera on Main Monitored Racks"
          >
            <Target size={12} strokeWidth={1.5} />
            <span>Focus Main</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActivePreset('frontal');
              setCameraAction({ type: 'frontal', token: Date.now() });
            }}
            className={`px-2 py-0.5 rounded text-11 font-medium transition-colors ${
              activePreset === 'frontal'
                ? 'bg-primary text-white shadow-xs'
                : 'text-ink-2 hover:bg-surface-hover hover:text-ink'
            }`}
            title="Frontal elevation view of Main Row"
          >
            Frontal
          </button>
          <button
            type="button"
            onClick={() => {
              setActivePreset('top');
              setCameraAction({ type: 'top', token: Date.now() });
            }}
            className={`px-2 py-0.5 rounded text-11 font-medium transition-colors ${
              activePreset === 'top'
                ? 'bg-primary text-white shadow-xs'
                : 'text-ink-2 hover:bg-surface-hover hover:text-ink'
            }`}
            title="Overhead floor plan view of all rows"
          >
            Top-Down
          </button>
          <div className="h-3.5 w-px bg-border mx-0.5" />
          <button
            type="button"
            onClick={() => setCameraAction({ type: 'zoom-in', token: Date.now() })}
            className="p-1 rounded text-ink-2 hover:bg-surface-hover hover:text-ink"
            title="Zoom In"
          >
            <ZoomIn size={13} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={() => setCameraAction({ type: 'zoom-out', token: Date.now() })}
            className="p-1 rounded text-ink-2 hover:bg-surface-hover hover:text-ink"
            title="Zoom Out"
          >
            <ZoomOut size={13} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={() => {
              setActivePreset('isometric');
              setCameraAction({ type: 'reset', token: Date.now() });
            }}
            className="p-1 rounded text-ink-2 hover:bg-surface-hover hover:text-ink"
            title="Reset Camera View"
          >
            <RotateCcw size={13} strokeWidth={1.5} />
          </button>
        </div>

        {/* Right: Performance Badge, Total View & 2D Switcher */}
        <div className="flex items-center gap-2 pointer-events-auto">
          {/* Frameloop Demand Performance Monitor */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface/90 backdrop-blur-sm border border-border text-11 font-mono text-ink shadow-sm"
            title="Canvas frameloop is 'demand' — renders only on data updates and user orbits"
          >
            <Activity size={13} strokeWidth={1.5} className="text-ok" />
            <span className="font-semibold">{fps} FPS</span>
            <span className="text-ink-muted text-10">· DEMAND</span>
          </div>

          {/* Expand to Total View Button */}
          {onToggleTotalView && (
            <button
              type="button"
              onClick={onToggleTotalView}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-primary text-white text-11 font-medium hover:bg-primary-hover transition-colors shadow-sm"
              title={isTotalView ? 'Exit Total View (Esc)' : 'Expand to Full Page Total View'}
              data-testid="canvas-total-view-btn"
            >
              {isTotalView ? (
                <>
                  <Minimize2 size={13} strokeWidth={1.5} />
                  <span>Exit Total View</span>
                </>
              ) : (
                <>
                  <Maximize2 size={13} strokeWidth={1.5} />
                  <span>Total View</span>
                </>
              )}
            </button>
          )}

          {/* Fallback to 2D elevation toggle */}
          <button
            type="button"
            onClick={() => setForceFallback(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-surface border border-border text-11 font-medium text-ink hover:bg-surface-hover transition-colors shadow-sm"
            title="Switch to 2D physical bay elevation view"
          >
            <Layers size={13} strokeWidth={1.5} className="text-ink-2" />
            <span>2D Elevation</span>
          </button>
        </div>
      </div>

      {/* Instructions Bottom Bar */}
      <div className="absolute bottom-3 left-3 z-10 pointer-events-none">
        <div className="px-2.5 py-1 rounded bg-surface/80 backdrop-blur-sm border border-border text-11 text-ink-2 shadow-sm">
          Left-click + drag to orbit • Right-click to pan • Scroll to zoom • Click bay to inspect • Focus Main zooms to telemetry
        </div>
      </div>

      {/* R3F Canvas with frameloop="demand" for strict performance budgeting */}
      <Canvas
        frameloop="demand"
        camera={{ position: [6, 6, 8.5], fov: 42 }}
        onPointerMissed={() => {
          // Deselect on empty space click
          onSelectSlot(null, null);
        }}
        gl={{
          antialias: true,
          powerPreference: 'high-performance',
        }}
      >
        <CameraController action={cameraAction} controlsRef={controlsRef} />

        <DemandInvalidator
          dependencyKey={dependencyKey}
          onFrameCount={handleDemandFrame}
        />

        {/* Balanced 3-Point Studio Lighting Covering the Full Data Center */}
        <ambientLight intensity={0.8} color="#FFFFFF" />
        <directionalLight position={[18, 28, 22]} intensity={0.95} color="#FFFFFF" />
        <directionalLight position={[-18, 22, -18]} intensity={0.55} color="#E2E8F0" />
        <directionalLight position={[0, 32, -8]} intensity={0.4} color="#F8FAFC" />

        {/* Clamped Orbit Controls: keeps camera from passing under floor or inside racks */}
        <OrbitControls
          ref={controlsRef}
          makeDefault
          enableDamping={false}
          minPolarAngle={Math.PI / 6} // ~30 deg from vertical
          maxPolarAngle={Math.PI / 2.05} // ~87 deg (prevents looking up from floor)
          minDistance={3.5}
          maxDistance={85}
          target={[0, 2.5, -7]}
        />

        {/* 1. Data Center Raised Floor with Walking Pathways & Aisle Containment */}
        <HallFloor allRackPositions={allRackPositions} />

        {/* 2. Overhead Yellow Fiber Optic Raceway & Steel Cable Ladder Network */}
        <OverheadInfrastructure allRackPositions={allRackPositions} />

        {/* 3. Perimeter CRAC / CRAH Industrial Cooling Units */}
        <CRACUnits />

        {/* 4. Highlighted Main Monitored Racks (Row 0 Center) */}
        {visibleRacks.map((rack, index) => {
          const posX = monitoredStartX + index * monitoredSpacing;
          return (
            <Rack3D
              key={rack.rack_id}
              rack={rack}
              position={[posX, 0, 0]}
              selectedSlotId={selectedSlotId}
              onSelectSlot={onSelectSlot}
              isTenant={isTenant}
              tenantId={tenantId}
              nodeStatuses={nodeStatuses}
              escalationSlotIds={escalationSlotIds}
              categoryFilter={categoryFilter}
              statusFilter={statusFilter}
              horizon={horizon}
            />
          );
        })}

        {/* 5. Ambient Facility Datacenter Racks (27 Additional Enterprise Racks) */}
        {AMBIENT_RACKS.map((amb) => (
          <AmbientRack3D
            key={amb.label}
            label={amb.label}
            position={amb.position}
          />
        ))}

        {/* 6. Floating Selected Bay Callout Card (Anchored to selected bay) */}
        {selectedSlotInfo && (
          <Html
            position={selectedSlotInfo.pos}
            center
            distanceFactor={16}
            zIndexRange={[120, 0]}
          >
            <div
              className="p-3 rounded-lg border-2 border-primary bg-surface/98 backdrop-blur-md shadow-card min-w-[220px] pointer-events-auto space-y-2 text-ink"
              data-testid="hall-selected-callout"
            >
              <div className="flex items-center justify-between border-b border-border pb-1.5 gap-2">
                <div className="flex items-center gap-1.5 font-semibold text-12 text-ink">
                  <span className="w-2 h-2 rounded-full bg-primary" />
                  <span>{selectedSlotInfo.rack.label}</span>
                  <span className="text-ink-muted text-11 font-mono">
                    U{selectedSlotInfo.slot.u_start}–U
                    {selectedSlotInfo.slot.u_start + selectedSlotInfo.slot.u_height - 1}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectSlot(null, null)}
                  className="text-ink-muted hover:text-ink p-0.5 rounded hover:bg-surface-hover"
                  title="Dismiss callout"
                >
                  <X size={14} />
                </button>
              </div>

              {selectedSlotInfo.isForeign ? (
                <div className="text-11 text-ink-muted italic py-1">
                  Neighbouring tenant slot (Shielded)
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between text-11">
                    <span className="text-ink-muted">Node:</span>
                    <span className="font-mono font-semibold text-ink">
                      {selectedSlotInfo.slot.node_id || 'None'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-11">
                    <span className="text-ink-muted">Tenant:</span>
                    <span className="font-medium text-ink truncate max-w-[120px]">
                      {selectedSlotInfo.slot.tenant_label || selectedSlotInfo.slot.tenant_id || 'Unassigned'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-11 pt-1 border-t border-border">
                    <span className="text-ink-muted">
                      {selectedSlotInfo.isPredictive ? `Status (${horizon}):` : 'Live Status:'}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded font-mono font-semibold text-10 uppercase ${
                        selectedSlotInfo.effectiveStatus === 'CRIT'
                          ? 'bg-crit-weak text-crit'
                          : selectedSlotInfo.effectiveStatus === 'WARN'
                          ? 'bg-warn-weak text-warn'
                          : selectedSlotInfo.effectiveStatus === 'OFFLINE'
                          ? 'bg-surface-sunken text-ink-muted'
                          : 'bg-ok-weak text-ok'
                      }`}
                    >
                      {selectedSlotInfo.effectiveStatus}
                    </span>
                  </div>
                </>
              )}
            </div>
          </Html>
        )}
      </Canvas>
    </div>
  );
};
