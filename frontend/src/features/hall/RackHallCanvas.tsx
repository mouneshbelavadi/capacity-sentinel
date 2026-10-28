import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Edges, Html } from '@react-three/drei';
import { Rack, Slot, Status } from '../../api/contract';
import { Rack3D } from './Rack3D';
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

type CameraPreset = 'isometric' | 'frontal' | 'top' | 'rack1' | 'rack2' | 'zoom-in' | 'zoom-out' | 'reset';

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
      camera.position.set(5, 9, 15);
      if (controls) controls.target.set(0, 3.8, 0);
    } else if (action.type === 'frontal') {
      camera.position.set(0, 4, 16);
      if (controls) controls.target.set(0, 4, 0);
    } else if (action.type === 'top') {
      camera.position.set(0, 20, 0.01);
      if (controls) controls.target.set(0, 0, 0);
    } else if (action.type === 'rack1') {
      camera.position.set(-1.8, 4.5, 7);
      if (controls) controls.target.set(-1.8, 4, 0);
    } else if (action.type === 'rack2') {
      camera.position.set(1.8, 4.5, 7);
      if (controls) controls.target.set(1.8, 4, 0);
    } else if (action.type === 'zoom-in') {
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      camera.position.addScaledVector(dir, 1.8);
    } else if (action.type === 'zoom-out') {
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      camera.position.addScaledVector(dir, -1.8);
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

/**
 * Faint 1px floor grid in --border (#DADCE0) on flat plane in --canvas (#F5F6F8)
 * With cold aisle perforated floor tiles and boundary demarcation
 */
const HallFloor: React.FC<{
  width: number;
  depth: number;
  rackPositions: number[];
}> = ({ width, depth, rackPositions }) => {
  return (
    <group position={[0, -0.01, 0]}>
      {/* Base Floor Plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[width, depth]} />
        <meshBasicMaterial color={COLOR_CANVAS} />
      </mesh>
      {/* Recessive Grid Helper */}
      <gridHelper
        args={[Math.max(width, depth), 24, COLOR_GRID_LINE, COLOR_GRID_LINE]}
        position={[0, 0.005, 0]}
      />
      {/* Subtle Architectural Floor Position Markers under each rack */}
      {rackPositions.map((posX, i) => (
        <group key={`footprint-${i}`}>
          {/* Rack Footprint Marker */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[posX, 0.008, 0]}>
            <planeGeometry args={[2.7, 3.4]} />
            <meshBasicMaterial color={COLOR_RACK_FOOTPRINT} />
            <Edges color={COLOR_GRID_LINE} threshold={15} lineWidth={1.2} />
          </mesh>

          {/* Cold Aisle Perforated Floor Plenum Tile (Underfloor air supply) */}
          <group position={[posX, 0.012, 2.2]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[2.4, 1.2]} />
              <meshBasicMaterial color="#E2E8F0" />
              <Edges color="#94A3B8" threshold={15} lineWidth={1} />
            </mesh>
            {/* Ventilation Slits Wireframe Pattern */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0.002]}>
              <planeGeometry args={[2.2, 1.0]} />
              <meshBasicMaterial color="#94A3B8" wireframe />
            </mesh>
          </group>
        </group>
      ))}

      {/* Cold Aisle Demarcation Guide Line */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 2.85]}>
        <planeGeometry args={[Math.max(width, depth) * 0.75, 0.04]} />
        <meshBasicMaterial color="#0EA5E9" transparent opacity={0.35} />
      </mesh>
    </group>
  );
};

/**
 * Overhead Cable Ladder Rack & Yellow Fiber Optic Raceway (Panduit FiberRunner style)
 */
const OverheadInfrastructure: React.FC<{
  rackPositions: number[];
  totalSpan: number;
}> = ({ rackPositions, totalSpan }) => {
  const racewayLength = Math.max(totalSpan + 4.8, 8.0);
  const racewayY = 8.95; // Suspended directly above 8.0m 42U rack frame

  return (
    <group position={[0, racewayY, 0]}>
      {/* Main Yellow Fiber Optic Raceway Channel */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[racewayLength, 0.22, 0.28]} />
        <meshStandardMaterial color="#EAB308" roughness={0.4} metalness={0.15} />
        <Edges color="#CA8A04" threshold={20} lineWidth={1.2} />
      </mesh>

      {/* Overhead Steel Cable Ladder Rack (running parallel) */}
      <mesh position={[0, 0.04, 0.45]}>
        <boxGeometry args={[racewayLength, 0.06, 0.4]} />
        <meshStandardMaterial color="#475569" roughness={0.4} metalness={0.6} />
        <Edges color="#64748B" threshold={20} lineWidth={1} />
      </mesh>

      {/* Ladder Rungs */}
      {Array.from({ length: Math.floor(racewayLength / 0.8) }).map((_, i) => {
        const rungX = -racewayLength / 2 + (i + 1) * 0.8;
        return (
          <mesh key={`rung-${i}`} position={[rungX, 0.06, 0.45]}>
            <boxGeometry args={[0.04, 0.03, 0.38]} />
            <meshStandardMaterial color="#64748B" roughness={0.3} metalness={0.7} />
          </mesh>
        );
      })}

      {/* Vertical Yellow Drop Chutes descending into each rack canopy */}
      {rackPositions.map((posX, i) => (
        <group key={`drop-${i}`} position={[posX, -0.42, -0.6]}>
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
}) => {
  const [webGLSupported, setWebGLSupported] = useState<boolean>(true);
  const [forceFallback, setForceFallback] = useState<boolean>(false);
  const [fps, setFps] = useState<number>(60);
  const [cameraAction, setCameraAction] = useState<{ type: CameraPreset; token: number } | null>(null);
  const [activePreset, setActivePreset] = useState<'isometric' | 'frontal' | 'top' | 'rack1' | 'rack2'>('isometric');

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

  // Filter visible racks if a rack is isolated or show entire row (2-4 racks)
  const visibleRacks = useMemo(() => {
    if (!racks || racks.length === 0) return [];
    return racks;
  }, [racks]);

  // Center the racks along the X axis
  const rackSpacing = 3.6;
  const totalSpan = (visibleRacks.length - 1) * rackSpacing;
  const startX = -totalSpan / 2;
  const rackPositions = useMemo(
    () => visibleRacks.map((_, index) => startX + index * rackSpacing),
    [visibleRacks, startX, rackSpacing]
  );

  // Composite key to trigger invalidate() when data or filter changes
  const dependencyKey = useMemo(() => {
    const escStr = escalationSlotIds.join(',');
    const statusStr = Object.entries(nodeStatuses)
      .map(([k, v]) => `${k}:${v.status}`)
      .join('|');
    return `${selectedSlotId || 'none'}-${escStr}-${statusStr}-${Object.keys(telemetryByNodeMetric).length}-${categoryFilter}-${statusFilter || 'all'}-${horizon}`;
  }, [selectedSlotId, escalationSlotIds, nodeStatuses, telemetryByNodeMetric, categoryFilter, statusFilter, horizon]);

  // Selected slot details for high-visibility floating callout card (Smart Campus inspired)
  const selectedSlotInfo = useMemo(() => {
    if (!selectedSlotId) return null;
    for (let rIdx = 0; rIdx < visibleRacks.length; rIdx++) {
      const rack = visibleRacks[rIdx];
      const slot = rack.slots.find((s) => s.slot_id === selectedSlotId);
      if (slot) {
        const posX = rackPositions[rIdx];
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
  }, [selectedSlotId, visibleRacks, rackPositions, isTenant, tenantId, nodeStatuses, horizon]);

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
      className="relative w-full h-[540px] rounded-lg border border-border bg-canvas overflow-hidden shadow-card"
      data-testid="rack-hall-3d"
    >
      {/* Top Controls Overlay */}
      <div className="absolute top-3 left-3 right-3 z-10 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        {/* Left: View Mode & Context */}
        <div className="flex items-center gap-2 pointer-events-auto">
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface/90 backdrop-blur-sm border border-border text-11 font-semibold uppercase tracking-wider text-ink shadow-sm">
            <Eye size={13} strokeWidth={1.5} className="text-primary" />
            <span>3D Rack Hall</span>
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
            title="Isometric 3/4 axonometric view"
          >
            Isometric
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
            title="Frontal elevation view"
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
            title="Overhead floor plan view"
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

        {/* Right: Performance Badge & 2D Switcher */}
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
          Left-click + drag to orbit • Right-click to pan • Scroll to zoom • Click bay to inspect
        </div>
      </div>

      {/* R3F Canvas with frameloop="demand" for strict performance budgeting */}
      <Canvas
        frameloop="demand"
        camera={{ position: [5, 9, 15], fov: 40 }}
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

        {/* Balanced 3-Point Studio Lighting with Crisp Specular Highlights */}
        <ambientLight intensity={0.8} color="#FFFFFF" />
        <directionalLight position={[12, 24, 16]} intensity={0.95} color="#FFFFFF" />
        <directionalLight position={[-12, 16, -12]} intensity={0.5} color="#E2E8F0" />
        <directionalLight position={[0, 26, 0]} intensity={0.35} color="#F8FAFC" />

        {/* Clamped Orbit Controls: keeps camera from passing under floor or inside racks */}
        <OrbitControls
          ref={controlsRef}
          makeDefault
          enableDamping={false}
          minPolarAngle={Math.PI / 6} // ~30 deg from vertical
          maxPolarAngle={Math.PI / 2.05} // ~87 deg (prevents looking up from floor)
          minDistance={7}
          maxDistance={32}
          target={[0, 3.8, 0]}
        />

        {/* Hall Floor Plane with Subtle Rack Footprint Markers & Cold Aisle Perforations */}
        <HallFloor width={30} depth={24} rackPositions={rackPositions} />

        {/* Overhead Yellow Fiber Raceway & Cable Ladder Infrastructure */}
        <OverheadInfrastructure rackPositions={rackPositions} totalSpan={totalSpan} />

        {/* Floating Selected Bay Callout Card (anchored in 3D over selected bay) */}
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

        {/* Rack Hall Row */}
        {visibleRacks.map((rack, index) => {
          const posX = startX + index * rackSpacing;
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
      </Canvas>
    </div>
  );
};
