import React, { useRef, useState, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { Edges, Html } from '@react-three/drei';
import { Slot, Status } from '../../api/contract';
import { getHatchTexture } from './hatchTexture';
import { TimelineHorizon } from './visualManagementTypes';
import { AlertTriangle, AlertOctagon, MinusCircle, Lock, Activity, Zap, Thermometer } from 'lucide-react';

// Design token hex equivalents from tokens.css
const COLOR_OK = '#00E676';
const COLOR_WARN = '#FFB300';
const COLOR_CRIT = '#FF1744';
const COLOR_OFFLINE = '#94A3B8';
const COLOR_PRIMARY = '#155FA6';
const COLOR_BORDER_STRONG = '#334155';
const COLOR_HOVER_BORDER = '#38BDF8';
const COLOR_CHASSIS_DARK = '#181C23'; // Brushed enterprise server steel
const COLOR_METAL_EAR = '#94A3B8'; // Aluminum rack ear
const COLOR_HANDLE = '#E2E8F0'; // Stainless steel pull handle
const COLOR_VENT_LINE = '#334155'; // Ventilation grille slits
const COLOR_DRIVE_BEZEL = '#21262D'; // Hot-swap drive caddy frame
const COLOR_DRIVE_LATCH = '#30363D'; // Drive release lever

interface Slot3DProps {
  slot: Slot;
  rackId: string;
  rackLabel: string;
  position: [number, number, number];
  size: [number, number, number];
  isSelected: boolean;
  isForeign: boolean;
  isEscalating: boolean;
  isDimmed?: boolean;
  effectiveStatus: Status;
  onSelect: (slot: Slot) => void;
  horizon?: TimelineHorizon;
}

export const Slot3D: React.FC<Slot3DProps> = ({
  slot,
  rackLabel,
  position,
  size,
  isSelected,
  isForeign,
  isEscalating,
  isDimmed = false,
  effectiveStatus,
  onSelect,
  horizon = 'now',
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const [hovered, setHovered] = useState(false);
  const { invalidate } = useThree();

  const isPredictive = horizon !== 'now';

  // Determine base color based on status and dimming filter
  const baseColor = useMemo(() => {
    if (isForeign) {
      return '#FFFFFF'; // Foreign uses crosshatch texture, no status color
    }
    if (isDimmed) {
      return '#E2E8F0'; // Dimmed non-relevant bay
    }
    return COLOR_CHASSIS_DARK;
  }, [isForeign, isDimmed]);

  // Status LED and status light bar color
  const statusLedColor = useMemo(() => {
    switch (effectiveStatus) {
      case 'OK':
        return COLOR_OK;
      case 'WARN':
        return COLOR_WARN;
      case 'CRIT':
        return COLOR_CRIT;
      case 'OFFLINE':
      default:
        return COLOR_OFFLINE;
    }
  }, [effectiveStatus]);

  // Single 600ms highlight sweep on escalation (respects prefers-reduced-motion)
  useEffect(() => {
    if (!isEscalating || isForeign || !materialRef.current) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      materialRef.current.color.set(baseColor);
      invalidate();
      return;
    }

    const startTime = performance.now();
    const duration = 600; // 600ms sweep budget per design-system.md §6
    let animationFrameId: number;

    const targetColor = new THREE.Color(baseColor);
    const highlightColor = new THREE.Color('#FFFFFF');

    const animatePulse = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      if (materialRef.current) {
        // Sine ease up to bright highlight and settle back
        const t = Math.sin(progress * Math.PI);
        materialRef.current.color.copy(targetColor).lerp(highlightColor, t * 0.7);
        invalidate();
      }

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(animatePulse);
      } else if (materialRef.current) {
        materialRef.current.color.set(baseColor);
        invalidate();
      }
    };

    animationFrameId = requestAnimationFrame(animatePulse);
    return () => cancelAnimationFrame(animationFrameId);
  }, [isEscalating, baseColor, isForeign, invalidate]);

  // Direct ref color update when status changes (avoids React tree re-renders)
  useEffect(() => {
    if (materialRef.current && !isForeign) {
      materialRef.current.color.set(baseColor);
      invalidate();
    }
  }, [baseColor, isForeign, invalidate]);

  const hatchTexture = useMemo(() => (isForeign ? getHatchTexture() : null), [isForeign]);

  const edgeColor = isSelected
    ? COLOR_PRIMARY
    : hovered
    ? COLOR_HOVER_BORDER
    : isForeign
    ? COLOR_BORDER_STRONG
    : statusLedColor;

  const halfWidth = size[0] / 2;
  const halfDepth = size[2] / 2;
  const earWidth = 0.09;
  const earHeight = size[1] * 0.94;

  // Number of hot-swap drive bays to render on the faceplate
  const driveCount = size[1] >= 0.28 ? 8 : 4;
  const driveWidth = 0.16;
  const driveHeight = size[1] >= 0.28 ? size[1] * 0.38 : size[1] * 0.65;

  return (
    <group position={position}>
      {/* 1. Primary Server Blade Unit Chassis Box */}
      <mesh
        ref={meshRef}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(slot);
          invalidate();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          invalidate();
        }}
        onPointerOut={() => {
          setHovered(false);
          invalidate();
        }}
      >
        <boxGeometry args={size} />
        <meshStandardMaterial
          ref={materialRef}
          color={isForeign ? '#FFFFFF' : baseColor}
          map={hatchTexture}
          roughness={isForeign ? 0.9 : 0.55}
          metalness={isForeign ? 0.0 : 0.35}
          transparent={!isForeign || isDimmed}
          opacity={isForeign ? 1.0 : isDimmed ? 0.35 : 0.96}
        />
        <Edges
          color={edgeColor}
          threshold={15}
          lineWidth={isSelected ? 2.5 : hovered ? 2 : 1}
        />
      </mesh>

      {/* 2. Realistic Enterprise Server Faceplate Detailing */}
      {!isForeign && !isDimmed && (
        <group position={[0, 0, halfDepth + 0.008]}>
          {/* Left Rack Ear Bracket with Mount Point */}
          <mesh position={[-halfWidth + earWidth / 2 + 0.01, 0, 0]}>
            <boxGeometry args={[earWidth, earHeight, 0.016]} />
            <meshStandardMaterial color={COLOR_METAL_EAR} roughness={0.3} metalness={0.7} />
          </mesh>
          {/* Left Stainless Steel Pull Handle */}
          <mesh position={[-halfWidth + earWidth / 2 + 0.01, 0, 0.018]}>
            <boxGeometry args={[0.022, earHeight * 0.65, 0.024]} />
            <meshStandardMaterial color={COLOR_HANDLE} roughness={0.15} metalness={0.9} />
          </mesh>

          {/* Right Rack Ear Bracket with Mount Point */}
          <mesh position={[halfWidth - earWidth / 2 - 0.01, 0, 0]}>
            <boxGeometry args={[earWidth, earHeight, 0.016]} />
            <meshStandardMaterial color={COLOR_METAL_EAR} roughness={0.3} metalness={0.7} />
          </mesh>
          {/* Right Stainless Steel Pull Handle */}
          <mesh position={[halfWidth - earWidth / 2 - 0.01, 0, 0.018]}>
            <boxGeometry args={[0.022, earHeight * 0.65, 0.024]} />
            <meshStandardMaterial color={COLOR_HANDLE} roughness={0.15} metalness={0.9} />
          </mesh>

          {/* Hot-Swap Drive Caddies (2.5" / 3.5" Disk Bays) */}
          <group position={[-halfWidth + earWidth + 0.06 + (driveCount * (driveWidth + 0.02)) / 2, 0, 0.004]}>
            {Array.from({ length: driveCount }).map((_, di) => {
              const driveX = (di - (driveCount - 1) / 2) * (driveWidth + 0.02);
              return (
                <group key={`drive-${di}`} position={[driveX, 0, 0]}>
                  {/* Drive Bezel Frame */}
                  <mesh>
                    <boxGeometry args={[driveWidth, driveHeight, 0.01]} />
                    <meshStandardMaterial color={COLOR_DRIVE_BEZEL} roughness={0.7} metalness={0.3} />
                    <Edges color="#30363D" threshold={20} lineWidth={1} />
                  </mesh>
                  {/* Drive Ejector Latch Line */}
                  <mesh position={[0, -driveHeight / 2 + 0.02, 0.006]}>
                    <boxGeometry args={[driveWidth * 0.8, 0.015, 0.004]} />
                    <meshStandardMaterial color={COLOR_DRIVE_LATCH} roughness={0.5} metalness={0.5} />
                  </mesh>
                  {/* Drive Activity Pinhead LED */}
                  <mesh position={[driveWidth / 2 - 0.025, driveHeight / 2 - 0.025, 0.006]}>
                    <boxGeometry args={[0.015, 0.015, 0.005]} />
                    <meshBasicMaterial color="#10B981" />
                  </mesh>
                </group>
              );
            })}
          </group>

          {/* Front Airflow Cooling Grille */}
          <mesh position={[halfWidth - earWidth - 0.38, 0, 0.003]}>
            <planeGeometry args={[0.48, size[1] * 0.55]} />
            <meshBasicMaterial color={COLOR_VENT_LINE} wireframe />
          </mesh>

          {/* Front Illuminated Status Light Bar (Horizontal Accent Light Strip) */}
          <mesh position={[0, -size[1] / 2 + 0.025, 0.008]}>
            <boxGeometry args={[size[0] * 0.76, 0.025, 0.012]} />
            <meshBasicMaterial color={statusLedColor} />
          </mesh>

          {/* Power LED Indicator (Left of right ear) */}
          <mesh position={[halfWidth - earWidth - 0.06, 0.02, 0.01]}>
            <boxGeometry args={[0.03, 0.03, 0.02]} />
            <meshBasicMaterial color="#00E676" />
          </mesh>

          {/* Health Status LED Indicator */}
          <mesh position={[halfWidth - earWidth - 0.02, 0.02, 0.01]}>
            <boxGeometry args={[0.035, 0.035, 0.02]} />
            <meshBasicMaterial color={statusLedColor} />
          </mesh>
        </group>
      )}

      {/* 3. Accessible Status Marker anchored on non-OK or selected slots */}
      {(!isForeign && !isDimmed && effectiveStatus !== 'OK') || isSelected ? (
        <Html
          position={[0, size[1] / 2 + 0.1, size[2] / 2 + 0.1]}
          center
          distanceFactor={18}
          zIndexRange={[100, 0]}
        >
          <div
            className={`pointer-events-none select-none flex items-center gap-1 px-1.5 py-0.5 rounded text-11 font-mono font-medium shadow-sm whitespace-nowrap transition-transform ${
              isSelected
                ? 'bg-surface border-2 border-primary text-primary font-semibold'
                : effectiveStatus === 'CRIT'
                ? 'bg-crit-weak border border-crit/40 text-crit'
                : effectiveStatus === 'WARN'
                ? 'bg-warn-weak border border-warn/40 text-warn'
                : 'bg-surface-sunken border border-border text-ink-muted'
            }`}
          >
            {effectiveStatus === 'CRIT' && <AlertOctagon size={12} strokeWidth={2} />}
            {effectiveStatus === 'WARN' && <AlertTriangle size={12} strokeWidth={2} />}
            {effectiveStatus === 'OFFLINE' && <MinusCircle size={12} strokeWidth={2} />}
            <span>
              {isSelected
                ? `U${slot.u_start} (${slot.node_id || 'unlet'})`
                : isPredictive
                ? `${effectiveStatus} (${horizon})`
                : effectiveStatus}
            </span>
          </div>
        </Html>
      ) : null}

      {/* 4. Rich Interactive Hover Tooltip */}
      {hovered && (
        <Html
          position={[0, size[1] / 2 + 0.22, 0]}
          center
          distanceFactor={16}
          zIndexRange={[200, 0]}
        >
          <div className="pointer-events-none select-none bg-surface border border-border rounded-lg shadow-card p-2.5 text-11 text-ink min-w-[190px] whitespace-nowrap">
            {isForeign ? (
              <div className="flex items-center gap-1.5 text-ink-muted font-medium">
                <Lock size={13} strokeWidth={1.5} />
                <span>Not your slot (Neighbour Shielded)</span>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="font-semibold text-12 text-ink flex items-center justify-between gap-3 pb-1 border-b border-border">
                  <span>{rackLabel}</span>
                  <span className="font-mono text-ink-2 font-medium">
                    U{slot.u_start}–U{slot.u_start + slot.u_height - 1} ({slot.u_height}U)
                  </span>
                </div>

                <div className="text-ink-2 text-11 flex justify-between">
                  <span>Node ID:</span>
                  <span className="font-mono text-primary font-semibold">{slot.node_id || 'None'}</span>
                </div>

                {slot.tenant_label && (
                  <div className="text-ink-2 text-11 flex justify-between">
                    <span>Tenant:</span>
                    <span className="text-ink font-medium">{slot.tenant_label}</span>
                  </div>
                )}

                {/* Horizon Context */}
                <div className="flex items-center justify-between pt-1 border-t border-border/60">
                  <span className="text-ink-2">
                    {isPredictive ? `Predicted (${horizon}):` : 'Live Status:'}
                  </span>
                  <span
                    className={`font-semibold font-mono ${
                      effectiveStatus === 'CRIT'
                        ? 'text-crit'
                        : effectiveStatus === 'WARN'
                        ? 'text-warn'
                        : effectiveStatus === 'OK'
                        ? 'text-ok'
                        : 'text-ink-muted'
                    }`}
                  >
                    {effectiveStatus}
                  </span>
                </div>

                {/* Live or Predicted Metric Callouts */}
                {slot.node_id && (
                  <div className="pt-1 border-t border-border/60 text-10 text-ink-muted space-y-0.5">
                    {slot.node_id === 'r1-n1' && (
                      <div className="flex items-center justify-between text-ink-2">
                        <span className="flex items-center gap-1">
                          <Thermometer size={11} className="text-primary" />
                          <span>Inlet Temp:</span>
                        </span>
                        <span className="font-mono font-semibold">
                          {isPredictive
                            ? horizon === '+24h' || horizon === '+48h'
                              ? '27.2 °C (Breach)'
                              : horizon === '+12h'
                              ? '26.5 °C'
                              : '25.4 °C'
                            : '24.6 °C'}
                        </span>
                      </div>
                    )}
                    {slot.node_id === 'r2-n1' && (
                      <div className="flex items-center justify-between text-ink-2">
                        <span className="flex items-center gap-1">
                          <Activity size={11} className="text-warn" />
                          <span>Vibration RMS:</span>
                        </span>
                        <span className="font-mono font-semibold">0.024 g (2× Base)</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-ink-2">
                      <span className="flex items-center gap-1">
                        <Zap size={11} className="text-accent" />
                        <span>Power (est.):</span>
                      </span>
                      <span className="font-mono font-semibold">1.08 W</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </Html>
      )}
    </group>
  );
};
