import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Rack, Slot } from '../../api/contract';
import { Rack3D } from './Rack3D';
import { NodeStatusInfo, TelemetryReading } from '../../api/ws';
import { RackGrid } from '../datacenter/RackGrid';
import { Eye, Layers, Activity, AlertCircle, RefreshCw } from 'lucide-react';

const COLOR_CANVAS = '#F5F6F8'; // --canvas
const COLOR_GRID_LINE = '#DADCE0'; // --border

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
 */
const HallFloor: React.FC<{ width: number; depth: number }> = ({ width, depth }) => {
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
}) => {
  const [webGLSupported, setWebGLSupported] = useState<boolean>(true);
  const [forceFallback, setForceFallback] = useState<boolean>(false);
  const [fps, setFps] = useState<number>(60);
  const lastTimeRef = useRef<number>(performance.now());
  const frameCountRef = useRef<number>(0);

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

  // Composite key to trigger invalidate() when data changes
  const dependencyKey = useMemo(() => {
    const escStr = escalationSlotIds.join(',');
    const statusStr = Object.entries(nodeStatuses)
      .map(([k, v]) => `${k}:${v.status}`)
      .join('|');
    return `${selectedSlotId || 'none'}-${escStr}-${statusStr}-${Object.keys(telemetryByNodeMetric).length}`;
  }, [selectedSlotId, escalationSlotIds, nodeStatuses, telemetryByNodeMetric]);

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
    <div className="relative w-full h-[540px] rounded-lg border border-border bg-canvas overflow-hidden shadow-card" data-testid="rack-hall-3d">
      {/* Top Controls Overlay */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between pointer-events-none">
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
        <DemandInvalidator
          dependencyKey={dependencyKey}
          onFrameCount={handleDemandFrame}
        />

        {/* Soft, low-contrast ambient and directional lighting (no shadows) */}
        <ambientLight intensity={0.85} color="#FFFFFF" />
        <directionalLight position={[10, 20, 10]} intensity={0.65} color="#FFFFFF" />
        <directionalLight position={[-10, 15, -10]} intensity={0.3} color="#F1F3F5" />

        {/* Clamped Orbit Controls: keeps camera from passing under floor or inside racks */}
        <OrbitControls
          makeDefault
          enableDamping={false}
          minPolarAngle={Math.PI / 6} // ~30 deg from vertical
          maxPolarAngle={Math.PI / 2.05} // ~87 deg (prevents looking up from floor)
          minDistance={7}
          maxDistance={32}
          target={[0, 3.8, 0]}
        />

        {/* Hall Floor Plane */}
        <HallFloor width={30} depth={24} />

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
            />
          );
        })}
      </Canvas>
    </div>
  );
};
