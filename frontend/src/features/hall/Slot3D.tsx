import React, { useRef, useState, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { Edges, Html } from '@react-three/drei';
import { Slot, Status } from '../../api/contract';
import { getHatchTexture } from './hatchTexture';
import { AlertTriangle, AlertOctagon, MinusCircle, Lock } from 'lucide-react';

// Design token hex equivalents from tokens.css
const COLOR_OK = '#1E8E3E';
const COLOR_WARN = '#C77700';
const COLOR_CRIT = '#C5221F';
const COLOR_OFFLINE = '#80868B';
const COLOR_PRIMARY = '#155FA6';
const COLOR_BORDER_STRONG = '#C4C7CC';
const COLOR_HOVER_BORDER = '#5F6368';

interface Slot3DProps {
  slot: Slot;
  rackId: string;
  rackLabel: string;
  position: [number, number, number];
  size: [number, number, number];
  isSelected: boolean;
  isForeign: boolean;
  isEscalating: boolean;
  effectiveStatus: Status;
  onSelect: (slot: Slot) => void;
}

export const Slot3D: React.FC<Slot3DProps> = ({
  slot,
  rackLabel,
  position,
  size,
  isSelected,
  isForeign,
  isEscalating,
  effectiveStatus,
  onSelect,
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const [hovered, setHovered] = useState(false);
  const { invalidate } = useThree();

  // Determine base color based on status
  const baseColor = useMemo(() => {
    if (isForeign) {
      return '#FFFFFF'; // Foreign uses crosshatch texture, no status color
    }
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
  }, [isForeign, effectiveStatus]);

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
        // Sine ease up to bright highlight and settle back to status color
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
    : COLOR_BORDER_STRONG;

  return (
    <group position={position}>
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
          roughness={0.6}
          metalness={0.1}
          transparent={!isForeign}
          opacity={isForeign ? 1.0 : 0.88}
        />
        <Edges
          color={edgeColor}
          threshold={15}
          lineWidth={isSelected ? 2.5 : hovered ? 2 : 1}
        />
      </mesh>

      {/* Accessible Status Marker anchored on non-OK or selected slots */}
      {(!isForeign && effectiveStatus !== 'OK') || isSelected ? (
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
                : effectiveStatus}
            </span>
          </div>
        </Html>
      ) : null}

      {/* Hover Tooltip */}
      {hovered && (
        <Html
          position={[0, size[1] / 2 + 0.2, 0]}
          center
          distanceFactor={16}
          zIndexRange={[200, 0]}
        >
          <div className="pointer-events-none select-none bg-surface border border-border rounded shadow-card p-2 text-11 text-ink min-w-[160px] whitespace-nowrap">
            {isForeign ? (
              <div className="flex items-center gap-1.5 text-ink-muted font-medium">
                <Lock size={12} strokeWidth={1.5} />
                <span>Not your slot</span>
              </div>
            ) : (
              <>
                <div className="font-semibold text-12 text-ink flex items-center justify-between gap-2">
                  <span>{rackLabel}</span>
                  <span className="font-mono text-ink-2">U{slot.u_start}–U{slot.u_start + slot.u_height - 1}</span>
                </div>
                <div className="mt-1 text-ink-2 text-11">
                  Node: <span className="font-mono text-primary font-medium">{slot.node_id || 'None'}</span>
                </div>
                {slot.tenant_label && (
                  <div className="text-ink-2 text-11">
                    Tenant: <span className="text-ink font-medium">{slot.tenant_label}</span>
                  </div>
                )}
                <div className="mt-1 flex items-center gap-1.5 font-semibold text-11">
                  Status:{' '}
                  <span
                    className={
                      effectiveStatus === 'CRIT'
                        ? 'text-crit'
                        : effectiveStatus === 'WARN'
                        ? 'text-warn'
                        : effectiveStatus === 'OK'
                        ? 'text-ok'
                        : 'text-ink-muted'
                    }
                  >
                    {effectiveStatus}
                  </span>
                </div>
              </>
            )}
          </div>
        </Html>
      )}
    </group>
  );
};
