import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VisualManagementView } from '../features/hall/VisualManagementView';
import { OverviewPanel } from '../features/hall/OverviewPanel';
import { ClassificationDonut } from '../features/hall/ClassificationDonut';
import { StatisticsBars } from '../features/hall/StatisticsBars';
import { ConsumptionGauges } from '../features/hall/ConsumptionGauges';
import { StatusDistribution } from '../features/hall/StatusDistribution';
import { TrendSparkline } from '../features/hall/TrendSparkline';
import { CategoryTabs } from '../features/hall/CategoryTabs';
import { ForecastTimelineBar } from '../features/hall/ForecastTimelineBar';
import { getPredictedSlotStatus } from '../features/hall/visualManagementTypes';
import { TopologyResponse, Rack } from '../api/contract';

const mockRacks: Rack[] = [
  {
    rack_id: 'rack-01',
    label: 'Rack 01',
    position: { row: 0, col: 0 },
    slots: [
      {
        slot_id: 'rack-01-u12',
        u_start: 12,
        u_height: 2,
        tenant_id: 't-alpha',
        tenant_label: 'Alpha Systems',
        node_id: 'r1-n1',
        status: 'OK',
      },
      {
        slot_id: 'rack-01-u14',
        u_start: 14,
        u_height: 2,
        tenant_id: 't-beta',
        tenant_label: 'Beta Compute',
        node_id: 'r1-n2',
        status: 'OK',
      },
      {
        slot_id: 'rack-01-u16',
        u_start: 16,
        u_height: 2,
        tenant_id: null,
        tenant_label: null,
        node_id: null,
        status: 'OFFLINE',
      },
    ],
  },
  {
    rack_id: 'rack-02',
    label: 'Rack 02',
    position: { row: 0, col: 1 },
    slots: [
      {
        slot_id: 'rack-02-u10',
        u_start: 10,
        u_height: 2,
        tenant_id: 't-beta',
        tenant_label: 'Beta Compute',
        node_id: 'r2-n1',
        status: 'WARN',
      },
      {
        slot_id: 'rack-02-u12',
        u_start: 12,
        u_height: 2,
        tenant_id: 't-alpha',
        tenant_label: 'Alpha Systems',
        node_id: 'r2-n2',
        status: 'CRIT',
      },
    ],
  },
];

const mockTopology: TopologyResponse = {
  site_id: 'site-01',
  racks: mockRacks,
};

describe('Phase 5 — Visual Management View & Surrounding Panels', () => {
  describe('OverviewPanel', () => {
    it('renders exact counts for racks, nodes, sensors, and tenants without fake data', () => {
      render(
        <OverviewPanel
          rackCount={2}
          nodesOnline={3}
          nodesTotal={4}
          sensorCount={8}
          tenantCount={2}
          isTenant={false}
        />
      );

      expect(screen.getByText('Overview')).toBeInTheDocument();
      expect(screen.getByText('Racks')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText('/ 4')).toBeInTheDocument();
      expect(screen.getByText('Sensors')).toBeInTheDocument();
      expect(screen.getByText('Tenants')).toBeInTheDocument();
    });

    it('renders tenant count as 1 when viewed in tenant mode', () => {
      render(
        <OverviewPanel
          rackCount={2}
          nodesOnline={2}
          nodesTotal={2}
          sensorCount={4}
          tenantCount={5}
          isTenant={true}
        />
      );

      // In tenant view, tenants count is strictly 1
      const tenantValues = screen.getAllByText('1');
      expect(tenantValues.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('ClassificationDonut', () => {
    it('renders sensor distribution breakdown with counts and percentages', () => {
      const dist = [
        { type: 'temp', name: 'Temperature', count: 3, color: '#1A73E8' },
        { type: 'rh', name: 'Humidity', count: 3, color: '#12B5CB' },
        { type: 'power', name: 'Power (est.)', count: 4, color: '#5F6368', isEstimated: true },
      ];

      render(<ClassificationDonut distribution={dist} />);

      expect(screen.getByText('Classification')).toBeInTheDocument();
      expect(screen.getByText('Temperature')).toBeInTheDocument();
      expect(screen.getByText('Humidity')).toBeInTheDocument();
      expect(screen.getByText('Power (est.)')).toBeInTheDocument();
      expect(screen.getByText('10')).toBeInTheDocument(); // 3 + 3 + 4 = 10 sensors
    });
  });

  describe('StatisticsBars', () => {
    it('renders operational margin progressbars with percentage labels', () => {
      render(
        <StatisticsBars
          rackCapacityPct={72}
          thermalMarginPct={54}
          powerMarginPct={37}
        />
      );

      expect(screen.getByText('Statistics')).toBeInTheDocument();
      expect(screen.getByText('Rack capacity')).toBeInTheDocument();
      expect(screen.getByText('72%')).toBeInTheDocument();
      expect(screen.getByText('Thermal margin')).toBeInTheDocument();
      expect(screen.getByText('54%')).toBeInTheDocument();
      expect(screen.getByText('Power est.')).toBeInTheDocument();
      expect(screen.getByText('37%')).toBeInTheDocument();

      // Power est carries the EST. provenance badge
      expect(screen.getByText('EST.')).toBeInTheDocument();
    });
  });

  describe('ConsumptionGauges', () => {
    it('renders PUE, IT Power, and Total Power with EST. badges', () => {
      render(
        <ConsumptionGauges
          itPowerWatts={2.16}
          pue={1.25}
          hasPowerData={true}
        />
      );

      expect(screen.getByText('Consumption')).toBeInTheDocument();
      expect(screen.getByText('est. 1.25')).toBeInTheDocument();
      expect(screen.getByText('2.16')).toBeInTheDocument();
      // Total power = 2.16 * 1.25 = 2.70
      expect(screen.getByText('2.70')).toBeInTheDocument();

      // Badges
      const estBadges = screen.getAllByText('EST.');
      expect(estBadges.length).toBeGreaterThanOrEqual(2);
    });

    it('renders empty state when no power data is present, never 0', () => {
      render(
        <ConsumptionGauges
          itPowerWatts={null}
          hasPowerData={false}
        />
      );

      expect(screen.getByText('No power data')).toBeInTheDocument();
      expect(screen.queryByText('0 W')).not.toBeInTheDocument();
    });
  });

  describe('StatusDistribution', () => {
    it('renders status counts and triggers filter on click', () => {
      const handleSelectStatus = vi.fn();
      render(
        <StatusDistribution
          okCount={5}
          warnCount={2}
          critCount={1}
          offlineCount={4}
          selectedStatus={null}
          onSelectStatus={handleSelectStatus}
        />
      );

      expect(screen.getByText('Status Distribution')).toBeInTheDocument();
      expect(screen.getByText('5')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
      expect(screen.getByText('1')).toBeInTheDocument();
      expect(screen.getByText('4')).toBeInTheDocument();

      // Click WARN button
      const warnBtn = screen.getByRole('button', { name: /Filter 3D hall by WARN/i });
      fireEvent.click(warnBtn);
      expect(handleSelectStatus).toHaveBeenCalledWith('WARN');
    });

    it('shows clear filter button when a status is active', () => {
      const handleSelectStatus = vi.fn();
      render(
        <StatusDistribution
          okCount={5}
          warnCount={2}
          critCount={1}
          offlineCount={4}
          selectedStatus="CRIT"
          onSelectStatus={handleSelectStatus}
        />
      );

      const clearBtn = screen.getByRole('button', { name: /Clear filter/i });
      expect(clearBtn).toBeInTheDocument();
      fireEvent.click(clearBtn);
      expect(handleSelectStatus).toHaveBeenCalledWith(null);
    });
  });

  describe('TrendSparkline', () => {
    it('renders headline value, unit, and worst node ID', () => {
      const trendData = [
        { ts: '2026-10-28T12:00:00Z', value: 24.1 },
        { ts: '2026-10-28T12:01:00Z', value: 24.6 },
      ];

      render(
        <TrendSparkline
          data={trendData}
          metricLabel="Inlet Temperature"
          unit="°C"
          worstNodeId="r1-n1"
        />
      );

      expect(screen.getByText('Trends')).toBeInTheDocument();
      expect(screen.getByText('Worst-margin trend (r1-n1)')).toBeInTheDocument();
      expect(screen.getByText('24.6')).toBeInTheDocument();
      expect(screen.getByText('°C')).toBeInTheDocument();
    });
  });

  describe('CategoryTabs', () => {
    it('renders all category tabs and switches active category on click', () => {
      const handleSelectTab = vi.fn();
      render(<CategoryTabs activeTab="all" onSelectTab={handleSelectTab} />);

      expect(screen.getByRole('tab', { name: 'All' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Temperature' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Vibration' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Air Quality' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /Power/ })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('tab', { name: 'Vibration' }));
      expect(handleSelectTab).toHaveBeenCalledWith('vibration');
    });
  });

  describe('ForecastTimelineBar & Predictive Horizons', () => {
    it('renders all horizon step buttons and live indicator when in now mode', () => {
      const handleChangeHorizon = vi.fn();
      render(
        <ForecastTimelineBar
          activeHorizon="now"
          onChangeHorizon={handleChangeHorizon}
          predictedBreaches={0}
        />
      );

      expect(screen.getByTestId('forecast-timeline-bar')).toBeInTheDocument();
      expect(screen.getByText(/LIVE TELEMETRY/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Now \(Live\)/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /\+1h/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /\+6h/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /\+12h/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /\+24h/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /\+48h/i })).toBeInTheDocument();
    });

    it('triggers onChangeHorizon when clicking a forecast step', () => {
      const handleChangeHorizon = vi.fn();
      render(
        <ForecastTimelineBar
          activeHorizon="now"
          onChangeHorizon={handleChangeHorizon}
          predictedBreaches={0}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /\+24h/i }));
      expect(handleChangeHorizon).toHaveBeenCalledWith('+24h');
    });

    it('displays predicted horizon banner and breach alert badge when breaches exist', () => {
      const handleChangeHorizon = vi.fn();
      render(
        <ForecastTimelineBar
          activeHorizon="+24h"
          onChangeHorizon={handleChangeHorizon}
          predictedBreaches={1}
        />
      );

      expect(screen.getByText(/PREDICTED HORIZON \(\+24h\)/i)).toBeInTheDocument();
      expect(screen.getByText(/1 Predicted Breach/i)).toBeInTheDocument();
    });

    it('getPredictedSlotStatus projects thermal breach for r1-n1 under ETS model', () => {
      const slot = mockRacks[0].slots[0]; // r1-n1, status OK
      expect(getPredictedSlotStatus(slot, 'now', 'OK')).toBe('OK');
      expect(getPredictedSlotStatus(slot, '+1h', 'OK')).toBe('OK');
      expect(getPredictedSlotStatus(slot, '+6h', 'OK')).toBe('WARN');
      expect(getPredictedSlotStatus(slot, '+12h', 'OK')).toBe('WARN');
      expect(getPredictedSlotStatus(slot, '+24h', 'OK')).toBe('CRIT');
      expect(getPredictedSlotStatus(slot, '+48h', 'OK')).toBe('CRIT');
    });

    it('getPredictedSlotStatus preserves OFFLINE state regardless of horizon', () => {
      const slot = mockRacks[0].slots[0];
      expect(getPredictedSlotStatus(slot, '+24h', 'OFFLINE')).toBe('OFFLINE');
    });
  });

  describe('Full VisualManagementView Composition', () => {
    it('composes all panels and 3D hall simultaneously', () => {
      render(
        <VisualManagementView
          topology={mockTopology}
          selectedRackId="rack-01"
          selectedSlot={null}
          onSelectSlot={vi.fn()}
        />
      );

      expect(screen.getByTestId('visual-management-view')).toBeInTheDocument();
      expect(screen.getByTestId('forecast-timeline-bar')).toBeInTheDocument();
      expect(screen.getByTestId('overview-panel')).toBeInTheDocument();
      expect(screen.getByTestId('classification-donut')).toBeInTheDocument();
      expect(screen.getByTestId('statistics-bars')).toBeInTheDocument();
      expect(screen.getByTestId('consumption-gauges')).toBeInTheDocument();
      expect(screen.getByTestId('status-distribution')).toBeInTheDocument();
      expect(screen.getByTestId('trend-sparkline')).toBeInTheDocument();
      expect(screen.getByTestId('category-tabs')).toBeInTheDocument();
      expect(screen.getByTestId('expand-total-view-card-btn')).toBeInTheDocument();
    });

    it('expands to full-page Total View mode with metrics on left and right sides', () => {
      render(
        <VisualManagementView
          topology={mockTopology}
          selectedRackId="rack-01"
          selectedSlot={null}
          onSelectSlot={vi.fn()}
        />
      );

      // Expand into Total View
      const expandBtn = screen.getByTestId('expand-total-view-card-btn');
      fireEvent.click(expandBtn);

      // Total view full-page container is mounted
      expect(screen.getByTestId('visual-management-total-view')).toBeInTheDocument();
      expect(screen.getByText(/3D Visual Management · Total View/i)).toBeInTheDocument();

      // Metrics exist on left and right floating overlay columns
      expect(screen.getByTestId('total-view-left-metrics')).toBeInTheDocument();
      expect(screen.getByTestId('total-view-right-metrics')).toBeInTheDocument();

      // Toggle metrics hide/show
      const toggleMetricsBtn = screen.getByTestId('toggle-side-metrics-btn');
      expect(screen.getByText('Hide Metrics')).toBeInTheDocument();
      fireEvent.click(toggleMetricsBtn);

      // Metrics overlay is hidden
      expect(screen.queryByTestId('total-view-left-metrics')).not.toBeInTheDocument();
      expect(screen.queryByTestId('total-view-right-metrics')).not.toBeInTheDocument();
      expect(screen.getByText('Show Metrics')).toBeInTheDocument();

      // Show metrics again
      fireEvent.click(screen.getByTestId('toggle-side-metrics-btn'));
      expect(screen.getByTestId('total-view-left-metrics')).toBeInTheDocument();
      expect(screen.getByTestId('total-view-right-metrics')).toBeInTheDocument();

      // Exit Total View mode via Exit button
      const exitBtn = screen.getByTestId('exit-total-view-btn');
      fireEvent.click(exitBtn);

      // Returns to standard dashboard view
      expect(screen.queryByTestId('visual-management-total-view')).not.toBeInTheDocument();
      expect(screen.getByTestId('visual-management-view')).toBeInTheDocument();
    });

    it('exits Total View mode when pressing Escape key', () => {
      render(
        <VisualManagementView
          topology={mockTopology}
          selectedRackId="rack-01"
          selectedSlot={null}
          onSelectSlot={vi.fn()}
        />
      );

      // Expand to Total View
      fireEvent.click(screen.getByTestId('expand-total-view-card-btn'));
      expect(screen.getByTestId('visual-management-total-view')).toBeInTheDocument();

      // Press Escape
      fireEvent.keyDown(window, { key: 'Escape' });

      // Exits Total View mode
      expect(screen.queryByTestId('visual-management-total-view')).not.toBeInTheDocument();
      expect(screen.getByTestId('visual-management-view')).toBeInTheDocument();
    });
  });
});
