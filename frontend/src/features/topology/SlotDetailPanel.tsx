import React, { useEffect, useState } from 'react';
import { Slot, Rack, TelemetryResponse } from '../../api/contract';
import { apiClient, ApiClientError } from '../../api/client';
import { DetailPanel } from '../../design/DetailPanel';
import { Value } from '../../design/Value';
import { StatusBadge } from '../../design/StatusBadge';
import { ErrorState } from '../../design/ErrorState';
import { MetricSparkline } from '../forecast/MetricSparkline';
import { AiPanel } from '../ai/AiPanel';
import {
  Server,
  Cpu,
  Thermometer,
  Droplets,
  Activity,
  Zap,
  Wind,
  ShieldAlert,
  AlertTriangle,
  Clock,
} from 'lucide-react';

export interface SlotDetailPanelProps {
  slot: Slot | null;
  rack: Rack | null;
  isOpen: boolean;
  onClose: () => void;
  isTenant?: boolean;
}

interface NodeTelemetryState {
  t_c?: TelemetryResponse;
  rh?: TelemetryResponse;
  vib_rms_g?: TelemetryResponse;
  power_w?: TelemetryResponse;
  mq_ratio?: TelemetryResponse;
}

export const SlotDetailPanel: React.FC<SlotDetailPanelProps> = ({
  slot,
  rack,
  isOpen,
  onClose,
  isTenant = false,
}) => {
  const [telemetry, setTelemetry] = useState<NodeTelemetryState>({});
  const [loading, setLoading] = useState<boolean>(false);
  const [nodeError, setNodeError] = useState<ApiClientError | null>(null);
  const [mqWarming, setMqWarming] = useState<boolean>(false);

  const nodeId = slot?.node_id;

  // Foreign slot condition
  const isForeign =
    isTenant && slot && slot.tenant_id === null && slot.status === 'UNKNOWN';

  useEffect(() => {
    if (!isOpen || !nodeId || isForeign) {
      setTelemetry({});
      setNodeError(null);
      setMqWarming(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setNodeError(null);
    setMqWarming(false);

    // Fetch primary metrics for node
    const metrics = ['t_c', 'rh', 'vib_rms_g', 'power_w', 'mq_ratio'];

    Promise.allSettled(
      metrics.map((m) =>
        apiClient.get<TelemetryResponse>(`/api/nodes/${nodeId}/telemetry?metric=${m}`)
      )
    ).then((results) => {
      if (cancelled) return;

      const newTelem: NodeTelemetryState = {};
      let primary404: ApiClientError | null = null;

      results.forEach((res, idx) => {
        const metricName = metrics[idx] as keyof NodeTelemetryState;
        if (res.status === 'fulfilled') {
          newTelem[metricName] = res.value;
        } else {
          const err = res.reason;
          if (err instanceof ApiClientError) {
            if (err.code === 'NOT_FOUND') {
              primary404 = err;
            } else if (err.code === 'SENSOR_WARMING_UP' && metricName === 'mq_ratio') {
              setMqWarming(true);
            }
          }
        }
      });

      if (primary404) {
        setNodeError(primary404);
      } else {
        setTelemetry(newTelem);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, nodeId, isForeign]);

  if (!slot) return null;

  const uRange = `U${slot.u_start}–U${slot.u_start + slot.u_height - 1} (${slot.u_height}U)`;

  return (
    <DetailPanel
      isOpen={isOpen}
      onClose={onClose}
      title={isForeign ? `Slot ${slot.slot_id}` : `Slot ${slot.slot_id} Details`}
      subtitle={rack ? `${rack.label} (${rack.rack_id}) • ${uRange}` : uRange}
    >
      {/* 1. Foreign Slot Treatment */}
      {isForeign ? (
        <div className="space-y-4" data-testid="foreign-slot-detail">
          <div className="p-4 rounded-lg border border-border hatch-foreign">
            <div className="flex items-center gap-2 mb-2">
              <ShieldAlert size={18} strokeWidth={1.5} className="text-ink" />
              <h4 className="text-13 font-semibold text-ink">Foreign Rack Bay</h4>
            </div>
            <p className="text-12 text-ink-2 leading-relaxed">
              This bay is allocated outside your tenant scope. Telemetry, active hardware nodes, and
              operational statuses are shielded in accordance with the tenant isolation protocol.
            </p>
          </div>

          <div className="p-3 bg-surface-sunken border border-border rounded text-11 text-ink-muted font-mono">
            GET /api/nodes/&lt;foreign-node&gt;/telemetry → 404 NOT_FOUND
          </div>
        </div>
      ) : nodeError ? (
        /* 2. Isolated Foreign Node Error (404 NOT_FOUND) */
        <div className="space-y-4" data-testid="node-error-state">
          <ErrorState
            code={nodeError.code}
            message="That node isn't in your view."
          />
          <p className="text-11 text-ink-muted">
            The requested node was not found within your authorized tenant scope.
          </p>
        </div>
      ) : !slot.node_id ? (
        /* 3. Empty Bay (No node installed) */
        <div className="space-y-4 text-center py-8">
          <Server size={32} strokeWidth={1.5} className="mx-auto text-ink-muted mb-2" />
          <h4 className="text-13 font-medium text-ink">Unpopulated Slot</h4>
          <p className="text-12 text-ink-2 max-w-xs mx-auto">
            No telemetry node is installed in bay {slot.slot_id}. Status remains OFFLINE until a node
            is provisioned.
          </p>
          <div className="pt-2">
            <StatusBadge status="OFFLINE" size="md" />
          </div>
        </div>
      ) : (
        /* 4. Populated Node View */
        <div className="space-y-5" data-testid="node-detail-content">
          {/* Node Identity & Specs */}
          <div className="p-3.5 bg-surface-sunken border border-border rounded-lg space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cpu size={16} strokeWidth={1.5} className="text-primary" />
                <span className="text-13 font-bold font-mono text-ink">{slot.node_id}</span>
              </div>
              <StatusBadge status={slot.status} size="sm" />
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border text-11">
              <div>
                <span className="text-ink-muted block">Firmware</span>
                <span className="font-mono text-ink-2 font-medium">v0.3.1-esp32</span>
              </div>
              <div>
                <span className="text-ink-muted block">Last Seen</span>
                <div className="flex items-center gap-1 font-mono text-ink-2">
                  <Clock size={12} strokeWidth={1.5} />
                  <span>12 s ago</span>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-border text-11">
              <span className="text-ink-muted block mb-1">Tenant Allocation</span>
              <span className="font-semibold text-ink">{slot.tenant_label || 'Unassigned'}</span>
            </div>
          </div>

          {/* Fitted Sensors List */}
          <div>
            <h4 className="text-11 font-semibold uppercase tracking-wide text-ink-2 mb-2">
              Fitted Sensors
            </h4>
            <div className="flex flex-wrap gap-1.5 text-11 font-mono">
              <span className="px-2 py-0.5 rounded border border-border bg-surface text-ink-2">
                DHT22 (Temp & RH)
              </span>
              <span className="px-2 py-0.5 rounded border border-border bg-surface text-ink-2">
                MPU6050 (Vibration RMS)
              </span>
              <span className="px-2 py-0.5 rounded border border-border bg-surface text-ink-2">
                MQ135 (Air Quality)
              </span>
              <span className="px-2 py-0.5 rounded border border-border bg-surface text-ink-2">
                SW-420 (Shock)
              </span>
            </div>
          </div>

          {/* Telemetry & Baseline Breakdown */}
          <div className="space-y-3">
            <h4 className="text-11 font-semibold uppercase tracking-wide text-ink-2">
              Live Sensor Telemetry
            </h4>

            {loading ? (
              <div className="space-y-2 animate-pulse">
                <div className="h-14 bg-surface-sunken rounded" />
                <div className="h-14 bg-surface-sunken rounded" />
                <div className="h-14 bg-surface-sunken rounded" />
              </div>
            ) : (
              <>
                {/* 1. Inlet Temperature */}
                <div className="p-3 border border-border rounded bg-surface space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-12 text-ink">
                      <Thermometer size={14} strokeWidth={1.5} className="text-ink-2" />
                      <span className="font-medium">Inlet Temperature</span>
                    </div>
                    {telemetry.t_c?.points?.length ? (
                      <Value
                        value={telemetry.t_c.points[telemetry.t_c.points.length - 1].value}
                        unit={telemetry.t_c.unit}
                        meta={telemetry.t_c.meta}
                      />
                    ) : (
                      <span className="text-11 text-ink-muted font-mono">—</span>
                    )}
                  </div>
                  {telemetry.t_c?.points && telemetry.t_c.points.length > 1 && (
                    <div className="flex items-center justify-between pt-1 border-t border-border/50">
                      <span className="text-11 text-ink-muted">Recent trend:</span>
                      <MetricSparkline
                        points={telemetry.t_c.points}
                        metric="t_c"
                        unit={telemetry.t_c.unit}
                      />
                    </div>
                  )}
                  <div className="text-11 text-ink-muted">
                    baseline captured 12 min ago, 340 samples
                  </div>
                </div>

                {/* 2. Relative Humidity */}
                <div className="p-3 border border-border rounded bg-surface space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-12 text-ink">
                      <Droplets size={14} strokeWidth={1.5} className="text-ink-2" />
                      <span className="font-medium">Relative Humidity</span>
                    </div>
                    {telemetry.rh?.points?.length ? (
                      <Value
                        value={telemetry.rh.points[telemetry.rh.points.length - 1].value}
                        unit={telemetry.rh.unit}
                        meta={telemetry.rh.meta}
                      />
                    ) : (
                      <span className="text-11 text-ink-muted font-mono">—</span>
                    )}
                  </div>
                  {telemetry.rh?.points && telemetry.rh.points.length > 1 && (
                    <div className="flex items-center justify-between pt-1 border-t border-border/50">
                      <span className="text-11 text-ink-muted">Recent trend:</span>
                      <MetricSparkline
                        points={telemetry.rh.points}
                        metric="rh"
                        unit={telemetry.rh.unit}
                      />
                    </div>
                  )}
                  <div className="text-11 text-ink-muted">
                    baseline captured 12 min ago, 340 samples
                  </div>
                </div>

                {/* 3. Vibration RMS */}
                <div className="p-3 border border-border rounded bg-surface space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-12 text-ink">
                      <Activity size={14} strokeWidth={1.5} className="text-ink-2" />
                      <span className="font-medium">Vibration RMS</span>
                    </div>
                    {telemetry.vib_rms_g?.points?.length ? (
                      <Value
                        value={telemetry.vib_rms_g.points[telemetry.vib_rms_g.points.length - 1].value}
                        unit={telemetry.vib_rms_g.unit}
                        meta={telemetry.vib_rms_g.meta}
                      />
                    ) : (
                      <span className="text-11 text-ink-muted font-mono">—</span>
                    )}
                  </div>
                  {telemetry.vib_rms_g?.points && telemetry.vib_rms_g.points.length > 1 && (
                    <div className="flex items-center justify-between pt-1 border-t border-border/50">
                      <span className="text-11 text-ink-muted">Recent trend:</span>
                      <MetricSparkline
                        points={telemetry.vib_rms_g.points}
                        metric="vib_rms_g"
                        unit={telemetry.vib_rms_g.unit}
                      />
                    </div>
                  )}
                  <div className="text-11 text-ink-muted">
                    baseline captured 12 min ago, 340 samples
                  </div>
                </div>

                {/* 4. Estimated Power */}
                <div className="p-3 border border-border rounded bg-surface space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-12 text-ink">
                      <Zap size={14} strokeWidth={1.5} className="text-ink-2" />
                      <span className="font-medium">Estimated Power</span>
                    </div>
                    {telemetry.power_w?.points?.length ? (
                      <Value
                        value={telemetry.power_w.points[telemetry.power_w.points.length - 1].value}
                        unit={telemetry.power_w.unit}
                        meta={telemetry.power_w.meta}
                      />
                    ) : (
                      <span className="text-11 text-ink-muted font-mono">—</span>
                    )}
                  </div>
                  <div className="text-11 text-ink-muted font-mono">
                    Model: P = P_idle + (P_busy - P_idle) × U (estimated)
                  </div>
                </div>

                {/* 5. Air Quality (MQ135) — Warming Up or Ratio */}
                <div className="p-3 border border-border rounded bg-surface space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-12 text-ink">
                      <Wind size={14} strokeWidth={1.5} className="text-ink-2" />
                      <span className="font-medium">MQ135 Air Quality</span>
                    </div>
                    {!mqWarming && telemetry.mq_ratio?.points?.length ? (
                      <Value
                        value={telemetry.mq_ratio.points[telemetry.mq_ratio.points.length - 1].value}
                        unit="ratio"
                        meta={telemetry.mq_ratio.meta}
                      />
                    ) : null}
                  </div>
                  {mqWarming ? (
                    <div className="p-2 rounded bg-warning-weak/20 border border-warning/30 flex items-start gap-1.5 text-11 text-ink mt-1">
                      <AlertTriangle size={14} strokeWidth={1.5} className="text-warning flex-shrink-0 mt-0.5" />
                      <p>
                        Warming up — the MQ135 needs its preheat before any reading is meaningful.
                      </p>
                    </div>
                  ) : (
                    <div className="text-11 text-ink-muted">
                      Published as clean Rs/R0 ratio. Never converted to uncalibrated ppm.
                    </div>
                  )}
                </div>

                {/* 6. Unbaselined Metric Example (Mechanical Shock) */}
                <div className="p-3 border border-dashed border-border rounded bg-surface space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-12 text-ink font-medium">Mechanical Shock Count</span>
                    <span className="text-11 text-ink-muted font-mono">SW-420</span>
                  </div>
                  <div className="text-11 text-ink-2">
                    No baseline captured. Capture one to enable status and forecasting.
                  </div>
                </div>

                {/* 7. AI Advisory & Commentary Section */}
                <AiPanel
                  nodeId={slot.node_id}
                  rackId={rack?.rack_id}
                  className="mt-4"
                />
              </>
            )}
          </div>
        </div>
      )}
    </DetailPanel>
  );
};
