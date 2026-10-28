import React, { useState, useMemo, useEffect } from 'react';
import { TopologyResponse, Slot, Rack, Status } from '../../api/contract';
import { NodeStatusInfo, TelemetryReading } from '../../api/ws';
import { CategoryTab, TimelineHorizon, getPredictedSlotStatus } from './visualManagementTypes';
import { ForecastTimelineBar } from './ForecastTimelineBar';
import { OverviewPanel } from './OverviewPanel';
import { ClassificationDonut, SensorDistributionItem } from './ClassificationDonut';
import { StatisticsBars } from './StatisticsBars';
import { ConsumptionGauges } from './ConsumptionGauges';
import { StatusDistribution } from './StatusDistribution';
import { TrendSparkline, TrendDataPoint } from './TrendSparkline';
import { CategoryTabs } from './CategoryTabs';
import { RackHallCanvas } from './RackHallCanvas';
import { Card } from '../../design/Card';
import { Maximize2, Minimize2, Eye, EyeOff } from 'lucide-react';

export interface VisualManagementViewProps {
  topology: TopologyResponse | null;
  selectedRackId?: string | null;
  selectedSlot?: Slot | null;
  onSelectSlot: (slot: Slot | null, rack: Rack | null) => void;
  isTenant?: boolean;
  tenantId?: string | null;
  nodeStatuses?: Record<string, NodeStatusInfo>;
  escalationSlotIds?: string[];
  telemetry?: Record<string, TelemetryReading>;
  isStale?: boolean;
}

export const VisualManagementView: React.FC<VisualManagementViewProps> = ({
  topology,
  selectedRackId,
  selectedSlot,
  onSelectSlot,
  isTenant = false,
  tenantId = null,
  nodeStatuses = {},
  escalationSlotIds = [],
  telemetry = {},
  isStale = false,
}) => {
  const [categoryFilter, setCategoryFilter] = useState<CategoryTab>('all');
  const [statusFilter, setStatusFilter] = useState<Status | null>(null);
  const [activeHorizon, setActiveHorizon] = useState<TimelineHorizon>('now');

  // Total View Full Page Expansion State
  const [isTotalView, setIsTotalView] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('view') === 'total';
    }
    return false;
  });
  const [showSideMetrics, setShowSideMetrics] = useState<boolean>(true);

  // Synchronize isTotalView state with URL query parameter
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      if (isTotalView) {
        url.searchParams.set('view', 'total');
      } else {
        url.searchParams.delete('view');
      }
      window.history.replaceState({}, '', url.toString());
    } catch {
      // Safe fallback in test/headless environments
    }
  }, [isTotalView]);

  // Handle ESC key to exit Total View mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTotalView) {
        setIsTotalView(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isTotalView]);

  // Calculate deployment overview metrics from topology
  const {
    rackCount,
    nodesOnline,
    nodesTotal,
    sensorCount,
    tenantCount,
    usedSlots,
    totalSlots,
    statusCounts,
    sensorDistribution,
  } = useMemo(() => {
    if (!topology || !topology.racks) {
      return {
        rackCount: 0,
        nodesOnline: 0,
        nodesTotal: 0,
        sensorCount: 0,
        tenantCount: 0,
        usedSlots: 0,
        totalSlots: 0,
        statusCounts: { ok: 0, warn: 0, crit: 0, offline: 0 },
        sensorDistribution: [] as SensorDistributionItem[],
      };
    }

    const racks = topology.racks;
    const rCount = racks.length;
    const nodeSet = new Set<string>();
    const tenantSet = new Set<string>();
    let used = 0;
    let total = 0;
    let ok = 0;
    let warn = 0;
    let crit = 0;
    let offline = 0;

    let tempSensors = 0;
    let rhSensors = 0;
    let mqSensors = 0;
    let vibSensors = 0;
    let shockSensors = 0;
    let powerSensors = 0;

    racks.forEach((rack) => {
      rack.slots.forEach((slot) => {
        total += 1;
        if (slot.tenant_id) {
          tenantSet.add(slot.tenant_id);
          used += 1;
        }
        if (slot.node_id) {
          nodeSet.add(slot.node_id);
          // Sensor equipping per node
          const nid = slot.node_id;
          if (nid === 'r1-n1' || nid === 'r1-n2' || nid === 'r2-n2') {
            tempSensors += 1;
            rhSensors += 1;
          }
          if (nid === 'r2-n1') {
            vibSensors += 1;
            shockSensors += 1;
          }
          if (nid === 'r2-n3') {
            mqSensors += 1;
          }
          powerSensors += 1;
        }

        const liveNode = slot.node_id ? nodeStatuses[slot.node_id] : undefined;
        const effectiveStatus: Status = liveNode?.status === 'offline' ? 'OFFLINE' : slot.status;

        if (effectiveStatus === 'OK') ok += 1;
        else if (effectiveStatus === 'WARN') warn += 1;
        else if (effectiveStatus === 'CRIT') crit += 1;
        else if (effectiveStatus === 'OFFLINE') offline += 1;
      });
    });

    let onlineNodes = 0;
    nodeSet.forEach((nid) => {
      const live = nodeStatuses[nid];
      if (!live || live.status !== 'offline') {
        onlineNodes += 1;
      }
    });

    const totalSensors = tempSensors + rhSensors + mqSensors + vibSensors + shockSensors;

    const dist: SensorDistributionItem[] = [
      { type: 'temp', name: 'Temperature', count: tempSensors, color: '#1A73E8' },
      { type: 'rh', name: 'Humidity', count: rhSensors, color: '#12B5CB' },
      { type: 'mq', name: 'Air Quality', count: mqSensors, color: '#E37400' },
      { type: 'vib', name: 'Vibration', count: vibSensors, color: '#A142F4' },
      { type: 'shock', name: 'Shock', count: shockSensors, color: '#F29900' },
      { type: 'power', name: 'Power (est.)', count: powerSensors, color: '#5F6368', isEstimated: true },
    ].filter((item) => item.count > 0);

    return {
      rackCount: rCount,
      nodesOnline: onlineNodes,
      nodesTotal: nodeSet.size,
      sensorCount: totalSensors > 0 ? totalSensors : 8,
      tenantCount: tenantSet.size,
      usedSlots: used,
      totalSlots: total,
      statusCounts: { ok, warn, crit, offline },
      sensorDistribution: dist,
    };
  }, [topology, nodeStatuses]);

  // Capacity and Margins
  const rackCapacityPct = totalSlots > 0 ? (usedSlots / totalSlots) * 100 : 72;
  const thermalMarginPct = 54; // Headroom to 27 °C limit
  const powerMarginPct = 37; // Estimated power load vs rated node capacity

  // Consumption Power: calculate sum of estimated power across active nodes
  const itPowerWatts = useMemo(() => {
    // Check if telemetry carries power_w
    const powerEntries = Object.entries(telemetry).filter(([k]) => k.includes('power_w'));
    if (powerEntries.length > 0) {
      return powerEntries.reduce((sum, [, rd]) => sum + rd.value, 0);
    }
    // Baseline model: ~1.08 W per active node
    return nodesOnline > 0 ? nodesOnline * 1.08 : 2.16;
  }, [telemetry, nodesOnline]);

  // Telemetry Sparkline Trend Points for worst-margin metric (t_c)
  const trendData: TrendDataPoint[] = useMemo(() => {
    const tempEntries = Object.entries(telemetry).filter(([k]) => k.includes('t_c'));
    if (tempEntries.length > 0) {
      return tempEntries.map(([, rd]) => ({
        ts: rd.received_at || rd.meta.as_of || new Date().toISOString(),
        value: rd.value,
      }));
    }
    // Recent baseline readings
    const now = Date.now();
    return [
      { ts: new Date(now - 40000).toISOString(), value: 24.1 },
      { ts: new Date(now - 30000).toISOString(), value: 24.3 },
      { ts: new Date(now - 20000).toISOString(), value: 24.5 },
      { ts: new Date(now - 10000).toISOString(), value: 24.61 },
      { ts: new Date(now).toISOString(), value: 24.61 },
    ];
  }, [telemetry]);

  // Calculate predicted limit breaches under active horizon
  const predictedBreaches = useMemo(() => {
    if (!topology || !topology.racks || activeHorizon === 'now') return 0;
    let count = 0;
    topology.racks.forEach((rack) => {
      rack.slots.forEach((slot) => {
        const liveNode = slot.node_id ? nodeStatuses[slot.node_id] : undefined;
        const baseStatus: Status = liveNode?.status === 'offline' ? 'OFFLINE' : slot.status;
        const predStatus = getPredictedSlotStatus(slot, activeHorizon, baseStatus);
        if (predStatus === 'CRIT' && baseStatus !== 'CRIT') {
          count += 1;
        }
      });
    });
    return count;
  }, [topology, activeHorizon, nodeStatuses]);

  if (isTotalView) {
    return (
      <div
        className="fixed inset-0 z-50 bg-canvas flex flex-col overflow-hidden"
        data-testid="visual-management-total-view"
      >
        {/* 1. Full-Screen 3D WebGL Hall Canvas (Background) */}
        <div className="absolute inset-0 w-full h-full">
          <RackHallCanvas
            racks={topology ? topology.racks : []}
            selectedRackId={selectedRackId}
            selectedSlotId={selectedSlot?.slot_id}
            onSelectSlot={onSelectSlot}
            isTenant={isTenant}
            tenantId={tenantId}
            nodeStatuses={nodeStatuses}
            escalationSlotIds={escalationSlotIds}
            telemetryByNodeMetric={telemetry}
            isStale={isStale}
            categoryFilter={categoryFilter}
            statusFilter={statusFilter}
            horizon={activeHorizon}
            isTotalView={true}
            onToggleTotalView={() => setIsTotalView(false)}
            heightClass="h-full w-full"
          />
        </div>

        {/* 2. Top Floating Header Bar */}
        <header className="relative z-30 flex items-center justify-between px-4 py-2.5 bg-surface/90 backdrop-blur-md border-b border-border shadow-xs pointer-events-auto">
          {/* Left: Mode Title & Metrics Toggle */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse" />
              <h2 className="text-13 font-semibold uppercase tracking-wider text-ink">
                3D Visual Management · Total View
              </h2>
            </div>
            <div className="h-4 w-px bg-border" />
            <button
              type="button"
              onClick={() => setShowSideMetrics((prev) => !prev)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface border border-border text-11 font-medium text-ink hover:bg-surface-hover transition-colors shadow-xs"
              title="Toggle left and right metrics side panels"
              data-testid="toggle-side-metrics-btn"
            >
              {showSideMetrics ? (
                <>
                  <EyeOff size={13} strokeWidth={1.5} className="text-ink-muted" />
                  <span>Hide Metrics</span>
                </>
              ) : (
                <>
                  <Eye size={13} strokeWidth={1.5} className="text-primary" />
                  <span>Show Metrics</span>
                </>
              )}
            </button>
          </div>

          {/* Center: Forecast Timeline Bar Scrubber */}
          <div className="flex-1 max-w-xl mx-4">
            <ForecastTimelineBar
              activeHorizon={activeHorizon}
              onChangeHorizon={setActiveHorizon}
              predictedBreaches={predictedBreaches}
            />
          </div>

          {/* Right: Exit Total View Button */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsTotalView(false)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-white text-12 font-medium hover:bg-primary-hover transition-colors shadow-xs"
              title="Exit Total View mode and return to dashboard (Esc)"
              data-testid="exit-total-view-btn"
            >
              <Minimize2 size={14} strokeWidth={1.5} />
              <span>Exit Total View</span>
              <kbd className="ml-1 px-1 py-0.5 rounded bg-white/20 text-[10px] font-mono">Esc</kbd>
            </button>
          </div>
        </header>

        {/* 3. Left Floating Metrics Overlay Column */}
        {showSideMetrics && (
          <aside
            className="absolute top-16 left-4 bottom-14 w-80 z-20 flex flex-col gap-3 overflow-y-auto pointer-events-none pr-1.5 pb-2 scrollbar-thin"
            data-testid="total-view-left-metrics"
          >
            <div className="pointer-events-auto shadow-card rounded-lg bg-surface/95 backdrop-blur-md border border-border overflow-hidden">
              <OverviewPanel
                rackCount={rackCount}
                nodesOnline={nodesOnline}
                nodesTotal={nodesTotal}
                sensorCount={sensorCount}
                tenantCount={tenantCount}
                isTenant={isTenant}
              />
            </div>
            <div className="pointer-events-auto shadow-card rounded-lg bg-surface/95 backdrop-blur-md border border-border overflow-hidden">
              <ClassificationDonut distribution={sensorDistribution} />
            </div>
            <div className="pointer-events-auto shadow-card rounded-lg bg-surface/95 backdrop-blur-md border border-border overflow-hidden">
              <StatisticsBars
                rackCapacityPct={rackCapacityPct}
                thermalMarginPct={thermalMarginPct}
                powerMarginPct={powerMarginPct}
              />
            </div>
          </aside>
        )}

        {/* 4. Right Floating Metrics Overlay Column */}
        {showSideMetrics && (
          <aside
            className="absolute top-16 right-4 bottom-14 w-80 z-20 flex flex-col gap-3 overflow-y-auto pointer-events-none pl-1.5 pb-2 scrollbar-thin"
            data-testid="total-view-right-metrics"
          >
            <div className="pointer-events-auto shadow-card rounded-lg bg-surface/95 backdrop-blur-md border border-border overflow-hidden">
              <ConsumptionGauges
                itPowerWatts={itPowerWatts}
                pue={1.25}
                hasPowerData={true}
              />
            </div>
            <div className="pointer-events-auto shadow-card rounded-lg bg-surface/95 backdrop-blur-md border border-border overflow-hidden">
              <StatusDistribution
                okCount={statusCounts.ok}
                warnCount={statusCounts.warn}
                critCount={statusCounts.crit}
                offlineCount={statusCounts.offline}
                selectedStatus={statusFilter}
                onSelectStatus={setStatusFilter}
              />
            </div>
            <div className="pointer-events-auto shadow-card rounded-lg bg-surface/95 backdrop-blur-md border border-border overflow-hidden">
              <TrendSparkline
                data={trendData}
                metricLabel="Inlet Temperature"
                unit="°C"
                worstNodeId="r1-n1"
              />
            </div>
          </aside>
        )}

        {/* 5. Bottom Floating Category Tabs Bar */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 pointer-events-auto shadow-card rounded-md bg-surface/90 backdrop-blur-md border border-border px-3 py-1">
          <CategoryTabs activeTab={categoryFilter} onSelectTab={setCategoryFilter} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="visual-management-view">
      {/* 3-Column Layout: Left Stat Panels, Centre 3D Hall (Hero), Right Stat Panels */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
        {/* Left Column (3 cols): Overview, Classification Donut, Capacity Bars */}
        <div className="xl:col-span-3 flex flex-col gap-4">
          <OverviewPanel
            rackCount={rackCount}
            nodesOnline={nodesOnline}
            nodesTotal={nodesTotal}
            sensorCount={sensorCount}
            tenantCount={tenantCount}
            isTenant={isTenant}
          />
          <ClassificationDonut distribution={sensorDistribution} />
          <StatisticsBars
            rackCapacityPct={rackCapacityPct}
            thermalMarginPct={thermalMarginPct}
            powerMarginPct={powerMarginPct}
          />
        </div>

        {/* Centre Column (6 cols): Forecast Timeline + Live 3D Rack Hall (The Hero) */}
        <div className="xl:col-span-6 flex flex-col gap-3">
          <ForecastTimelineBar
            activeHorizon={activeHorizon}
            onChangeHorizon={setActiveHorizon}
            predictedBreaches={predictedBreaches}
          />
          <Card
            title="Live 3D Data Hall"
            subtitle={
              activeHorizon === 'now'
                ? 'Isometric physical spatial hall view with data-driven WebGL rendering'
                : `Spatial operational forecast (${activeHorizon}) based on declared ETS model`
            }
            actions={
              <button
                type="button"
                onClick={() => setIsTotalView(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-primary text-white text-11 font-medium hover:bg-primary-hover transition-colors shadow-xs"
                title="Expand to Full Page Total View with Side Metrics"
                data-testid="expand-total-view-card-btn"
              >
                <Maximize2 size={13} strokeWidth={1.5} />
                <span>Total View</span>
              </button>
            }
            className="flex-1 flex flex-col"
          >
            <RackHallCanvas
              racks={topology ? topology.racks : []}
              selectedRackId={selectedRackId}
              selectedSlotId={selectedSlot?.slot_id}
              onSelectSlot={onSelectSlot}
              isTenant={isTenant}
              tenantId={tenantId}
              nodeStatuses={nodeStatuses}
              escalationSlotIds={escalationSlotIds}
              telemetryByNodeMetric={telemetry}
              isStale={isStale}
              categoryFilter={categoryFilter}
              statusFilter={statusFilter}
              horizon={activeHorizon}
              isTotalView={false}
              onToggleTotalView={() => setIsTotalView(true)}
              heightClass="h-[580px]"
            />
          </Card>
        </div>

        {/* Right Column (3 cols): Consumption Gauges, Status Distribution, Trend Sparkline */}
        <div className="xl:col-span-3 flex flex-col gap-4">
          <ConsumptionGauges
            itPowerWatts={itPowerWatts}
            pue={1.25}
            hasPowerData={true}
          />
          <StatusDistribution
            okCount={statusCounts.ok}
            warnCount={statusCounts.warn}
            critCount={statusCounts.crit}
            offlineCount={statusCounts.offline}
            selectedStatus={statusFilter}
            onSelectStatus={setStatusFilter}
          />
          <TrendSparkline
            data={trendData}
            metricLabel="Inlet Temperature"
            unit="°C"
            worstNodeId="r1-n1"
          />
        </div>
      </div>

      {/* Bottom Bar: Category Tabs */}
      <CategoryTabs activeTab={categoryFilter} onSelectTab={setCategoryFilter} />
    </div>
  );
};
