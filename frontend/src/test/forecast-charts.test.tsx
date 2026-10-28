import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ForecastConeChart } from '../features/forecast/ForecastConeChart';
import { VibrationBaselineChart } from '../features/forecast/VibrationBaselineChart';
import { TenantAttributionChart } from '../features/forecast/TenantAttributionChart';
import { PowerEstimateChart } from '../features/forecast/PowerEstimateChart';
import { MetricSparkline } from '../features/forecast/MetricSparkline';
import { ForecastResponse, AttributionResponse } from '../api/contract';

describe('Phase 4 Forecast Cone, Charts & Attribution Tests', () => {
  const sampleForecastHeating: ForecastResponse = {
    forecast_id: 'fc_0193',
    node_id: 'r1-n1',
    metric: 't_c',
    limit: 27.0,
    limit_source: 'ASHRAE TC9.9 recommended inlet upper bound',
    model: 'ets_damped_additive',
    window_start: '2026-10-28T10:00:00Z',
    window_reason: 'changepoint:cp_0042',
    horizon_s: 7200,
    history: [
      { ts: '2026-10-28T10:00:00Z', value: 24.1 },
      { ts: '2026-10-28T10:02:00Z', value: 24.8 },
      { ts: '2026-10-28T10:04:00Z', value: 25.4 },
    ],
    median: [
      { ts: '2026-10-28T10:04:00Z', value: 25.4 },
      { ts: '2026-10-28T10:06:00Z', value: 26.0 },
      { ts: '2026-10-28T10:10:00Z', value: 27.0 },
    ],
    p10: [
      { ts: '2026-10-28T10:04:00Z', value: 25.4 },
      { ts: '2026-10-28T10:06:00Z', value: 25.7 },
      { ts: '2026-10-28T10:10:00Z', value: 26.5 },
    ],
    p90: [
      { ts: '2026-10-28T10:04:00Z', value: 25.4 },
      { ts: '2026-10-28T10:06:00Z', value: 26.4 },
      { ts: '2026-10-28T10:10:00Z', value: 27.8 },
    ],
    crossing: {
      has_trend: true,
      p10_s: 180, // 3 min
      p50_s: 360, // 6 min
      p90_s: 660, // 11 min
      no_breach_fraction: 0.12,
    },
    slope: {
      value: 0.014,
      unit: '°C/s',
      ci_low: 0.009,
      ci_high: 0.019,
    },
    calibration: {
      nominal: 0.8,
      empirical_coverage: 0.74,
      widen_factor: 1.18,
    },
    meta: {
      quality: 'estimated',
      model: 'ets_damped_additive',
      uncertainty_pct: null,
      as_of: '2026-10-28T10:04:00Z',
    },
  };

  const sampleForecastStable: ForecastResponse = {
    ...sampleForecastHeating,
    forecast_id: 'fc_0194',
    crossing: {
      has_trend: false,
      p10_s: null,
      p50_s: null,
      p90_s: null,
      no_breach_fraction: 0.94,
    },
    slope: {
      value: 0.001,
      unit: '°C/s',
      ci_low: -0.004,
      ci_high: 0.006,
    },
    window_reason: 'rolling_30m',
  };

  const sampleAttribution: AttributionResponse = {
    rack_id: 'rack-01',
    metric: 't_c',
    contributors: [
      {
        tenant_id: 't-beta',
        tenant_label: 'Beta Compute',
        share: 0.71,
        basis: 'slope increased 3.1x within 40s of tenant node r2-n1 coming online',
        meta: { quality: 'inferred', as_of: '2026-10-28T10:04:00Z' },
      },
      {
        tenant_id: 't-alpha',
        tenant_label: 'Alpha Systems',
        share: 0.29,
        basis: 'steady baseline thermal envelope from slot U12',
        meta: { quality: 'inferred', as_of: '2026-10-28T10:04:00Z' },
      },
    ],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // Acceptance Test 1: Warm real DHT22 -> cone appears, countdown, no_breach_fraction visible
  it('renders forecast cone headline countdown and always displays no_breach_fraction when has_trend is true', () => {
    render(<ForecastConeChart forecast={sampleForecastHeating} />);

    // Headline stat tile
    expect(screen.getByText(/Cooling margin runs out in/i)).toBeInTheDocument();
    expect(screen.getByText('6 min')).toBeInTheDocument();
    expect(screen.getByText(/range 3–11 min/i)).toBeInTheDocument();

    // no_breach_fraction MUST always be displayed per §1
    expect(screen.getByText(/12%/i)).toBeInTheDocument();
    expect(screen.getByText(/no breach within 2 h/i)).toBeInTheDocument();

    // Calibration widening factor
    expect(screen.getByText(/Interval widened ×1.18 from observed coverage/i)).toBeInTheDocument();

    // Window reset marker
    expect(screen.getByText(/Window reset by regime change/i)).toBeInTheDocument();
  });

  // Acceptance Test 2: Cool until slope CI contains zero -> cone disappears, honest no trend text
  it('displays "No sustained trend — no exhaustion forecast" and hides the cone when slope CI contains zero', () => {
    render(<ForecastConeChart forecast={sampleForecastStable} />);

    // Must show exact required text per §1 & Hard Rules
    expect(
      screen.getAllByText(/No sustained trend — no exhaustion forecast/i).length
    ).toBeGreaterThanOrEqual(1);

    // No ETA countdown should exist
    expect(screen.queryByText(/runs out in/i)).not.toBeInTheDocument();
  });

  // Acceptance Test 3: Vibration vs baseline with x baseline y-axis
  it('renders vibration chart with "× baseline" label, baseline caption, and 2x/4x reference thresholds', () => {
    const vibPoints = [
      { ts: '2026-10-28T10:00:00Z', value: 0.012 },
      { ts: '2026-10-28T10:02:00Z', value: 0.026 }, // 2.17x (WARN breached)
    ];

    render(
      <VibrationBaselineChart
        points={vibPoints}
        baselineRmsG={0.012}
        baselineCapturedAt="2026-10-28 08:00:00Z"
        baselineSampleCount={2400}
      />
    );

    // Baseline caption
    expect(screen.getByText(/Baseline captured/i)).toBeInTheDocument();
    expect(screen.getByText(/2,400/i)).toBeInTheDocument();
    expect(screen.getByText(/2.17× baseline/i)).toBeInTheDocument();
  });

  // Acceptance Test 4: Attribution with horizontal bars, basis string, and INFERRED badge
  it('renders tenant attribution with INFERRED badge and always renders the basis string under the bars', () => {
    render(<TenantAttributionChart attribution={sampleAttribution} />);

    // INFERRED badge
    expect(screen.getByText('INFERRED')).toBeInTheDocument();

    // Contributors
    expect(screen.getByText('Beta Compute')).toBeInTheDocument();
    expect(screen.getByText('71%')).toBeInTheDocument();
    expect(screen.getByText('Alpha Systems')).toBeInTheDocument();
    expect(screen.getByText('29%')).toBeInTheDocument();

    // Basis strings must ALWAYS be rendered per §4
    expect(
      screen.getByText(/slope increased 3.1x within 40s of tenant node r2-n1 coming online/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/steady baseline thermal envelope from slot U12/i)
    ).toBeInTheDocument();
  });

  // Acceptance Test 5: Estimated power in its own chart with EST. badge and formula
  it('renders estimated power in its own chart with EST. badge and declared model formula', () => {
    const powerPoints = [
      { ts: '2026-10-28T10:00:00Z', value: 0.98 },
      { ts: '2026-10-28T10:02:00Z', value: 1.08 },
    ];

    render(
      <PowerEstimateChart
        points={powerPoints}
        modelDetail={{
          formula: 'P = P_idle + (P_busy − P_idle)·u',
          p_idle_w: 0.45,
          p_busy_w: 1.4,
          u: 0.62,
          calibrated: false,
          reference: 'Fan et al.',
        }}
      />
    );

    expect(screen.getByText('EST.')).toBeInTheDocument();
    expect(screen.getByText('P = P_idle + (P_busy − P_idle)·u')).toBeInTheDocument();
    expect(screen.getByText(/P_idle=0.45W, P_busy=1.4W, u=0.62/i)).toBeInTheDocument();
  });

  // Acceptance Test 6: Table view toggle on every chart
  it('provides a "View as table" toggle that renders accessible tabular data with provenance labels', () => {
    render(<ForecastConeChart forecast={sampleForecastHeating} />);

    const toggleBtn = screen.getByRole('button', { name: /Switch to table view/i });
    expect(toggleBtn).toBeInTheDocument();

    // Click toggle
    fireEvent.click(toggleBtn);

    // Table view is active
    expect(screen.getByText('Observed (Measured)')).toBeInTheDocument();
    expect(screen.getByText('Median P50 (Estimated)')).toBeInTheDocument();
    expect(screen.getByText('P10 Lower (Estimated)')).toBeInTheDocument();
    expect(screen.getByText('P90 Upper (Estimated)')).toBeInTheDocument();
    expect(screen.getAllByText('EST.').length).toBeGreaterThan(0);
  });

  // Acceptance Test 7: Metric sparklines
  it('renders 2px sparkline with tabular end label and no dot per point', () => {
    const points = [
      { ts: '2026-10-28T10:00:00Z', value: 24.1 },
      { ts: '2026-10-28T10:02:00Z', value: 24.6 },
    ];

    const { container } = render(
      <MetricSparkline points={points} metric="t_c" unit="°C" />
    );

    expect(container.querySelector('svg path')).toBeInTheDocument();
    expect(screen.getByText('24.6 °C')).toBeInTheDocument();
  });

  // Acceptance Test 8: Empty and insufficient states per §7
  it('renders honest empty state when FORECAST_INSUFFICIENT_DATA is returned', async () => {
    const { ForecastView } = await import('../features/forecast/ForecastView');
    const { apiClient, ApiClientError } = await import('../api/client');

    vi.spyOn(apiClient, 'get').mockRejectedValue(
      new ApiClientError(400, 'FORECAST_INSUFFICIENT_DATA', 'Not enough history yet.')
    );

    render(<ForecastView />);

    expect(await screen.findByText('Not enough history yet')).toBeInTheDocument();
    expect(
      screen.getByText(/Forecasting starts after ~5 minutes of readings/i)
    ).toBeInTheDocument();
  });

  it('renders "Warming up" text banner with no chart or numbers when SENSOR_WARMING_UP is returned', async () => {
    const { ForecastView } = await import('../features/forecast/ForecastView');
    const { apiClient, ApiClientError } = await import('../api/client');

    vi.spyOn(apiClient, 'get').mockRejectedValue(
      new ApiClientError(400, 'SENSOR_WARMING_UP', 'Warming up.')
    );

    render(<ForecastView />);

    expect(await screen.findByText('Warming up')).toBeInTheDocument();
    expect(
      screen.getByText(/The sensor is currently in its preheat cycle/i)
    ).toBeInTheDocument();
    // No number, no chart
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('renders text and no chart when a metric has no baseline captured', async () => {
    const { ForecastView } = await import('../features/forecast/ForecastView');
    const { apiClient, ApiClientError } = await import('../api/client');

    vi.spyOn(apiClient, 'get').mockRejectedValue(
      new ApiClientError(400, 'INTERNAL', 'No baseline captured for this metric.')
    );

    render(<ForecastView />);

    expect(await screen.findByText('No baseline captured')).toBeInTheDocument();
    expect(
      screen.getByText(/Capture a commissioning baseline to enable status and forecasting/i)
    ).toBeInTheDocument();
  });
});
