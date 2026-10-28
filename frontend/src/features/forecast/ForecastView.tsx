import React, { useState, useEffect, useCallback } from 'react';
import {
  ForecastResponse,
  AttributionResponse,
  TelemetryResponse,
  Metric,
} from '../../api/contract';
import { apiClient, ApiClientError } from '../../api/client';
import { useAuthStore } from '../../app/authStore';
import { ForecastConeChart } from './ForecastConeChart';
import { VibrationBaselineChart } from './VibrationBaselineChart';
import { TenantAttributionChart } from './TenantAttributionChart';
import { PowerEstimateChart } from './PowerEstimateChart';
import { ErrorState } from '../../design/ErrorState';
import { EmptyState } from '../../design/EmptyState';
import { Chip } from '../../design/Chip';
import {
  Activity,
  Server,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';

export const ForecastView: React.FC = () => {
  const { user } = useAuthStore();
  const isTenant = user?.role === 'TENANT';

  // Allowed node list depending on tenant isolation scope
  const availableNodes = isTenant
    ? [
        { id: 'r1-n2', label: 'Rack 01 - Bay U18 (r1-n2)', rackId: 'rack-01', metric: 't_c' as Metric },
        { id: 'r2-n1', label: 'Rack 02 - Bay U10 (r2-n1)', rackId: 'rack-02', metric: 'vib_rms_g' as Metric },
      ]
    : [
        { id: 'r1-n1', label: 'Rack 01 - Bay U12 (r1-n1) [Heating]', rackId: 'rack-01', metric: 't_c' as Metric },
        { id: 'r1-n2', label: 'Rack 01 - Bay U18 (r1-n2)', rackId: 'rack-01', metric: 't_c' as Metric },
        { id: 'r2-n1', label: 'Rack 02 - Bay U10 (r2-n1) [Vibration]', rackId: 'rack-02', metric: 'vib_rms_g' as Metric },
        { id: 'r2-n2', label: 'Rack 02 - Bay U22 (r2-n2) [Stable]', rackId: 'rack-02', metric: 't_c' as Metric },
        { id: 'r2-n3', label: 'Rack 02 - Bay U30 (r2-n3) [Insufficient]', rackId: 'rack-02', metric: 't_c' as Metric },
      ];

  const [selectedNodeId, setSelectedNodeId] = useState<string>(availableNodes[0].id);
  const selectedNode = availableNodes.find((n) => n.id === selectedNodeId) || availableNodes[0];

  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [attribution, setAttribution] = useState<AttributionResponse | null>(null);
  const [powerTelemetry, setPowerTelemetry] = useState<TelemetryResponse | null>(null);
  const [vibrationTelemetry, setVibrationTelemetry] = useState<TelemetryResponse | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [insufficientData, setInsufficientData] = useState<boolean>(false);
  const [unbaselined, setUnbaselined] = useState<boolean>(false);
  const [warmingUp, setWarmingUp] = useState<boolean>(false);

  const loadForecastData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setInsufficientData(false);
    setUnbaselined(false);
    setWarmingUp(false);

    try {
      // 1. Fetch Forecast
      const fc = await apiClient.get<ForecastResponse>(
        `/api/forecast/${selectedNode.id}/${selectedNode.metric}`
      );
      setForecast(fc);

      // 2. Fetch Attribution for the rack
      const attr = await apiClient.get<AttributionResponse>(
        `/api/attribution/${selectedNode.rackId}?metric=${selectedNode.metric}`
      );
      setAttribution(attr);

      // 3. Fetch Power telemetry
      const pwr = await apiClient.get<TelemetryResponse>(
        `/api/nodes/${selectedNode.id}/telemetry?metric=power_w`
      );
      setPowerTelemetry(pwr);

      // 4. If node has vibration, fetch vibration telemetry
      if (selectedNode.metric === 'vib_rms_g') {
        const vib = await apiClient.get<TelemetryResponse>(
          `/api/nodes/${selectedNode.id}/telemetry?metric=vib_rms_g`
        );
        setVibrationTelemetry(vib);
      } else {
        setVibrationTelemetry(null);
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.code === 'FORECAST_INSUFFICIENT_DATA') {
          setInsufficientData(true);
        } else if ((err.code as string) === 'NO_BASELINE_CAPTURED' || err.message?.toLowerCase().includes('no baseline')) {
          setUnbaselined(true);
        } else if (err.code === 'SENSOR_WARMING_UP') {
          setWarmingUp(true);
        } else {
          setError(err);
        }
      } else {
        setError(
          new ApiClientError(500, 'INTERNAL', err instanceof Error ? err.message : 'Unknown error')
        );
      }
    } finally {
      setLoading(false);
    }
  }, [selectedNode]);

  useEffect(() => {
    loadForecastData();
  }, [loadForecastData]);

  return (
    <div className="space-y-6" data-testid="forecast-view">
      {/* Controls Bar: Node selector & Scope notice */}
      <div className="p-4 bg-surface border border-border rounded-lg shadow-card flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-ink font-semibold text-13">
            <Server size={16} strokeWidth={1.5} className="text-primary" />
            <span>Select Target Bay:</span>
          </div>
          <select
            value={selectedNodeId}
            onChange={(e) => setSelectedNodeId(e.target.value)}
            className="px-3 py-1.5 bg-surface-sunken border border-border rounded text-12 font-medium text-ink focus:outline-none focus:border-primary"
            aria-label="Select Target Bay for Capacity and Forecast Analysis"
          >
            {availableNodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={loadForecastData}
            className="p-1.5 rounded hover:bg-surface-hover text-ink-2 border border-border"
            title="Refresh forecast model"
            aria-label="Refresh forecast model"
          >
            <RotateCcw size={14} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex items-center gap-2 text-11 text-ink-2">
          <span>Scope:</span>
          <Chip variant="neutral">
            {isTenant ? `TENANT (${user?.tenant_id || 'Scoped'})` : 'DATA CENTER WIDE'}
          </Chip>
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="space-y-4 animate-pulse">
          <div className="h-44 bg-surface border border-border rounded-lg" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="h-64 bg-surface border border-border rounded-lg" />
            <div className="h-64 bg-surface border border-border rounded-lg" />
          </div>
        </div>
      ) : error ? (
        <ErrorState
          code={error.code}
          message={error.message || 'Unable to compute forecast model'}
          detail={error.detail}
        />
      ) : insufficientData ? (
        /* Honest empty state per §7 */
        <EmptyState
          icon={AlertTriangle}
          title="Not enough history yet"
          description="Forecasting starts after ~5 minutes of readings. The ETS damped model requires an established history window."
        />
      ) : unbaselined ? (
        /* Honest unbaselined metric state per §7 */
        <EmptyState
          icon={Activity}
          title="No baseline captured"
          description="No baseline captured for this metric. Capture a commissioning baseline to enable status and forecasting."
        />
      ) : warmingUp ? (
        /* Honest warming up state per §7: NEVER a number, NEVER a chart */
        <EmptyState
          icon={AlertTriangle}
          title="Warming up"
          description="The sensor is currently in its preheat cycle. Readings will start streaming once stabilized. No chart or number is rendered."
        />
      ) : (
        <div className="space-y-6">
          {/* 1. Centerpiece: Forecast Cone Chart */}
          {forecast && (
            <ForecastConeChart
              forecast={forecast}
              title={`Exhaustion Forecast — ${selectedNode.label}`}
            />
          )}

          {/* 2. Grid of Supporting Visualizations */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Attribution Chart (Rack thermal attribution) */}
            {attribution && (
              <TenantAttributionChart
                attribution={attribution}
                title={`Tenant Attribution — ${selectedNode.rackId}`}
              />
            )}

            {/* Estimated Power (Dedicated Chart, never sharing line/axis) */}
            {powerTelemetry && (
              <PowerEstimateChart
                points={powerTelemetry.points}
                title={`Estimated Power — ${selectedNode.id}`}
              />
            )}
          </div>

          {/* 3. Vibration vs Baseline (only when node has vibration data) */}
          {vibrationTelemetry && (
            <VibrationBaselineChart
              points={vibrationTelemetry.points}
              title={`Vibration vs Baseline — ${selectedNode.id}`}
            />
          )}
        </div>
      )}
    </div>
  );
};
