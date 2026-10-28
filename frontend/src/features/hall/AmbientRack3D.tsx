import React from 'react';
import { Edges, Html } from '@react-three/drei';

const COLOR_CABINET = '#1E232A'; // Enterprise dark charcoal chassis frame
const COLOR_PLINTH = '#16191F'; // Plinth base & roof canopy
const COLOR_RAIL = '#475569'; // EIA-310 19-inch mounting rail
const COLOR_RAIL_NOTCH = '#94A3B8'; // U-marking notches
const COLOR_SIDE_INSET = '#13161B'; // Recessed side panel wall
const COLOR_BORDER_FRAME = '#334155'; // Edge definition line
const COLOR_CONTACT_SHADOW = '#0F172A'; // Ground contact shadow
const COLOR_CHASSIS_DARK = '#181C23'; // Brushed enterprise server steel
const COLOR_METAL_EAR = '#94A3B8'; // Aluminum rack ear
const COLOR_HANDLE = '#E2E8F0'; // Stainless steel pull handle
const COLOR_VENT_LINE = '#334155'; // Ventilation grille slits
const COLOR_DRIVE_BEZEL = '#21262D'; // Hot-swap drive caddy frame
const COLOR_DRIVE_LATCH = '#30363D'; // Drive release lever

interface AmbientRack3DProps {
  label: string;
  position: [number, number, number];
}

/**
 * Enterprise Ambient Server Rack (Facility Inventory Rack)
 * Replicates the identical high-fidelity server rack hardware (plinth, canopy, rails,
 * server blades, hot-swap drive bays, pull handles, power LEDs) without telemetry alarm badges.
 */
export const AmbientRack3D: React.FC<AmbientRack3DProps> = ({ label, position }) => {
  const rackWidth = 2.4;
  const rackDepth = 3.1;
  const rackHeight = 8.0; // 42U total span
  const uScale = rackHeight / 42; // ~0.1905 units per U

  // Standard 2U server blade parameters
  const serverUHeight = 2;
  const bladeHeight = serverUHeight * uScale - 0.03; // ~0.35
  const bladeWidth = rackWidth - 0.22;
  const bladeDepth = rackDepth - 0.28;
  const halfWidth = bladeWidth / 2;
  const halfDepth = bladeDepth / 2;
  const earWidth = 0.09;
  const earHeight = bladeHeight * 0.94;
  const driveCount = 6;
  const driveWidth = 0.16;
  const driveHeight = bladeHeight * 0.38;

  // 14 standard 2U enterprise server blade units spanning the full 42U height
  const bladeUnits = React.useMemo(() => {
    const units: { uStart: number; posY: number }[] = [];
    for (let u = 1; u <= 41; u += 3) {
      const posY = (u - 1 + serverUHeight / 2) * uScale;
      units.push({ uStart: u, posY });
    }
    return units;
  }, [uScale]);

  return (
    <group position={position}>
      {/* 1. Ground Contact Shadow Plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
        <planeGeometry args={[rackWidth + 0.8, rackDepth + 0.8]} />
        <meshBasicMaterial color={COLOR_CONTACT_SHADOW} transparent opacity={0.18} />
      </mesh>

      {/* 2. Plinth Base Pedestal */}
      <mesh position={[0, 0.08, 0]}>
        <boxGeometry args={[rackWidth + 0.14, 0.16, rackDepth + 0.14]} />
        <meshStandardMaterial color={COLOR_PLINTH} roughness={0.6} metalness={0.4} />
        <Edges color={COLOR_BORDER_FRAME} threshold={20} lineWidth={1.2} />
      </mesh>

      {/* Plinth Leveling Feet */}
      {[-rackWidth / 2 + 0.08, rackWidth / 2 - 0.08].map((lx, lxi) =>
        [-rackDepth / 2 + 0.08, rackDepth / 2 - 0.08].map((lz, lzi) => (
          <mesh key={`amb-foot-${lxi}-${lzi}`} position={[lx, 0.03, lz]}>
            <boxGeometry args={[0.12, 0.06, 0.12]} />
            <meshStandardMaterial color="#64748B" roughness={0.3} metalness={0.7} />
          </mesh>
        ))
      )}

      {/* 3. Top Roof Canopy Enclosure */}
      <mesh position={[0, rackHeight + 0.08, 0]}>
        <boxGeometry args={[rackWidth + 0.14, 0.16, rackDepth + 0.14]} />
        <meshStandardMaterial color={COLOR_PLINTH} roughness={0.6} metalness={0.4} />
        <Edges color={COLOR_BORDER_FRAME} threshold={20} lineWidth={1.2} />
      </mesh>

      {/* Dual Exhaust Fan Grilles on Canopy Top */}
      {[-0.45, 0.45].map((fanX, fi) => (
        <group key={`amb-fan-${fi}`} position={[fanX, rackHeight + 0.165, 0]}>
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

      {/* Top Cable Entry Collar */}
      <mesh position={[0, rackHeight + 0.17, -0.6]}>
        <boxGeometry args={[0.34, 0.04, 0.34]} />
        <meshStandardMaterial color="#475569" roughness={0.5} metalness={0.5} />
      </mesh>

      {/* 4. Structural Corner Uprights */}
      {[-rackWidth / 2 + 0.05, rackWidth / 2 - 0.05].map((px, pxi) =>
        [-rackDepth / 2 + 0.05, rackDepth / 2 - 0.05].map((pz, pzi) => (
          <mesh key={`amb-post-${pxi}-${pzi}`} position={[px, rackHeight / 2, pz]}>
            <boxGeometry args={[0.1, rackHeight, 0.1]} />
            <meshStandardMaterial color={COLOR_CABINET} roughness={0.5} metalness={0.3} />
            <Edges color={COLOR_BORDER_FRAME} threshold={20} lineWidth={1} />
          </mesh>
        ))
      )}

      {/* 5. Front EIA-310 19" Vertical Mounting Rails */}
      {[-rackWidth / 2 + 0.11, rackWidth / 2 - 0.11].map((rx, ri) => (
        <group key={`amb-rail-${ri}`} position={[rx, rackHeight / 2, rackDepth / 2 - 0.12]}>
          <mesh>
            <boxGeometry args={[0.04, rackHeight, 0.06]} />
            <meshStandardMaterial color={COLOR_RAIL} roughness={0.4} metalness={0.6} />
            <Edges color="#64748B" threshold={20} lineWidth={1} />
          </mesh>
          {[10, 20, 30, 40].map((u) => (
            <mesh key={`amb-u-tick-${u}`} position={[0, (u - 21) * uScale, 0.032]}>
              <boxGeometry args={[0.035, 0.015, 0.008]} />
              <meshBasicMaterial color={COLOR_RAIL_NOTCH} />
            </mesh>
          ))}
        </group>
      ))}

      {/* 6. Cabinet Side Panels */}
      <group position={[-rackWidth / 2 + 0.01, rackHeight / 2, 0]}>
        <mesh>
          <boxGeometry args={[0.02, rackHeight * 0.96, rackDepth * 0.94]} />
          <meshStandardMaterial color={COLOR_CABINET} roughness={0.7} metalness={0.2} />
          <Edges color={COLOR_BORDER_FRAME} threshold={30} lineWidth={1} />
        </mesh>
        <mesh position={[-0.005, 0, 0]}>
          <boxGeometry args={[0.01, rackHeight * 0.88, rackDepth * 0.84]} />
          <meshStandardMaterial color={COLOR_SIDE_INSET} roughness={0.8} metalness={0.15} />
        </mesh>
      </group>
      <group position={[rackWidth / 2 - 0.01, rackHeight / 2, 0]}>
        <mesh>
          <boxGeometry args={[0.02, rackHeight * 0.96, rackDepth * 0.94]} />
          <meshStandardMaterial color={COLOR_CABINET} roughness={0.7} metalness={0.2} />
          <Edges color={COLOR_BORDER_FRAME} threshold={30} lineWidth={1} />
        </mesh>
        <mesh position={[0.005, 0, 0]}>
          <boxGeometry args={[0.01, rackHeight * 0.88, rackDepth * 0.84]} />
          <meshStandardMaterial color={COLOR_SIDE_INSET} roughness={0.8} metalness={0.15} />
        </mesh>
      </group>

      {/* 7. Rear Perforated Door */}
      <group position={[0, rackHeight / 2, -rackDepth / 2 + 0.02]}>
        <mesh>
          <planeGeometry args={[rackWidth - 0.2, rackHeight * 0.94]} />
          <meshBasicMaterial color="#1E293B" wireframe />
        </mesh>
      </group>

      {/* 8. Subtle Non-Distracting Rack Nameplate on Canopy */}
      <Html position={[0, rackHeight + 0.35, 0]} center distanceFactor={22}>
        <div className="pointer-events-none select-none px-2 py-0.5 rounded bg-surface/85 backdrop-blur-xs border border-border/80 text-[10px] font-mono font-medium text-ink-muted whitespace-nowrap shadow-xs">
          {label}
        </div>
      </Html>

      {/* 9. Replicated Enterprise Server Blades Stacked in the Rack */}
      {bladeUnits.map((blade, bi) => (
        <group key={`amb-blade-${bi}`} position={[0, blade.posY, 0]}>
          {/* Chassis */}
          <mesh>
            <boxGeometry args={[bladeWidth, bladeHeight, bladeDepth]} />
            <meshStandardMaterial color={COLOR_CHASSIS_DARK} roughness={0.55} metalness={0.35} />
            <Edges color="#334155" threshold={20} lineWidth={1} />
          </mesh>

          {/* Faceplate Detailing */}
          <group position={[0, 0, halfDepth + 0.008]}>
            {/* Left Ear & Stainless Handle */}
            <mesh position={[-halfWidth + earWidth / 2 + 0.01, 0, 0]}>
              <boxGeometry args={[earWidth, earHeight, 0.016]} />
              <meshStandardMaterial color={COLOR_METAL_EAR} roughness={0.3} metalness={0.7} />
            </mesh>
            <mesh position={[-halfWidth + earWidth / 2 + 0.01, 0, 0.018]}>
              <boxGeometry args={[0.022, earHeight * 0.65, 0.024]} />
              <meshStandardMaterial color={COLOR_HANDLE} roughness={0.15} metalness={0.9} />
            </mesh>

            {/* Right Ear & Stainless Handle */}
            <mesh position={[halfWidth - earWidth / 2 - 0.01, 0, 0]}>
              <boxGeometry args={[earWidth, earHeight, 0.016]} />
              <meshStandardMaterial color={COLOR_METAL_EAR} roughness={0.3} metalness={0.7} />
            </mesh>
            <mesh position={[halfWidth - earWidth / 2 - 0.01, 0, 0.018]}>
              <boxGeometry args={[0.022, earHeight * 0.65, 0.024]} />
              <meshStandardMaterial color={COLOR_HANDLE} roughness={0.15} metalness={0.9} />
            </mesh>

            {/* Hot-Swap Drive Caddies */}
            <group position={[-halfWidth + earWidth + 0.06 + (driveCount * (driveWidth + 0.02)) / 2, 0, 0.004]}>
              {Array.from({ length: driveCount }).map((_, di) => {
                const driveX = (di - (driveCount - 1) / 2) * (driveWidth + 0.02);
                return (
                  <group key={`drive-${bi}-${di}`} position={[driveX, 0, 0]}>
                    <mesh>
                      <boxGeometry args={[driveWidth, driveHeight, 0.01]} />
                      <meshStandardMaterial color={COLOR_DRIVE_BEZEL} roughness={0.7} metalness={0.3} />
                      <Edges color="#30363D" threshold={20} lineWidth={1} />
                    </mesh>
                    <mesh position={[0, -driveHeight / 2 + 0.02, 0.006]}>
                      <boxGeometry args={[driveWidth * 0.8, 0.015, 0.004]} />
                      <meshStandardMaterial color={COLOR_DRIVE_LATCH} roughness={0.5} metalness={0.5} />
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
              <planeGeometry args={[0.48, bladeHeight * 0.55]} />
              <meshBasicMaterial color={COLOR_VENT_LINE} wireframe />
            </mesh>

            {/* Front Light Strip along bottom */}
            <mesh position={[0, -bladeHeight / 2 + 0.025, 0.008]}>
              <boxGeometry args={[bladeWidth * 0.76, 0.025, 0.012]} />
              <meshBasicMaterial color="#00E676" />
            </mesh>

            {/* Power LED Indicator */}
            <mesh position={[halfWidth - earWidth - 0.06, 0.02, 0.01]}>
              <boxGeometry args={[0.03, 0.03, 0.02]} />
              <meshBasicMaterial color="#00E676" />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
};

