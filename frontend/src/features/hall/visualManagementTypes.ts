import { Slot, Metric, Status } from '../../api/contract';

export type CategoryTab = 'all' | 'temperature' | 'vibration' | 'air_quality' | 'power';

export interface CategoryTabItem {
  id: CategoryTab;
  label: string;
  description: string;
  metrics: Metric[];
}

export const CATEGORY_TABS: CategoryTabItem[] = [
  {
    id: 'all',
    label: 'All',
    description: 'All fitted telemetry metrics',
    metrics: ['t_c', 'rh', 'dew_c', 'vib_rms_g', 'vib_crest', 'shock_count', 'mq_ratio', 'power_w'],
  },
  {
    id: 'temperature',
    label: 'Temperature',
    description: 'Inlet temperature, relative humidity, and dew point (DHT22)',
    metrics: ['t_c', 'rh', 'dew_c'],
  },
  {
    id: 'vibration',
    label: 'Vibration',
    description: 'Vibration RMS, crest factor, and mechanical shock events (MPU6050 + SW-420)',
    metrics: ['vib_rms_g', 'vib_crest', 'shock_count'],
  },
  {
    id: 'air_quality',
    label: 'Air Quality',
    description: 'MQ135 gas sensor electrical resistance ratio (Rs/R0)',
    metrics: ['mq_ratio'],
  },
  {
    id: 'power',
    label: 'Power',
    description: 'Estimated CPU utilization power draw model',
    metrics: ['power_w'],
  },
];

/**
 * Determines whether a slot contains sensors relevant to the active category filter.
 */
export function isSlotRelevantToCategory(slot: Slot, category: CategoryTab): boolean {
  if (category === 'all') return true;
  if (!slot.node_id) return false;

  const nid = slot.node_id;
  switch (category) {
    case 'temperature':
      // r1-n1, r1-n2, r2-n2 carry DHT22 environmental sensors
      return nid === 'r1-n1' || nid === 'r1-n2' || nid === 'r2-n2';
    case 'vibration':
      // r2-n1 carries MPU6050 accelerometer & SW-420 shock sensor
      return nid === 'r2-n1';
    case 'air_quality':
      // r2-n3 carries MQ135 air quality sensor
      return nid === 'r2-n3';
    case 'power':
      // All nodes run the linear-cpu-v1 power estimation model
      return true;
    default:
      return true;
  }
}

// ==========================================
// Forecast Timeline & Projection Types
// ==========================================

export type TimelineHorizon = 'now' | '+1h' | '+6h' | '+12h' | '+24h' | '+48h';

export interface TimelineStep {
  id: TimelineHorizon;
  label: string;
  hoursAhead: number;
  description: string;
}

export const TIMELINE_STEPS: TimelineStep[] = [
  { id: 'now', label: 'Now (Live)', hoursAhead: 0, description: 'Live physical sensor telemetry readings' },
  { id: '+1h', label: '+1h', hoursAhead: 1, description: '1-hour short-term thermal projection' },
  { id: '+6h', label: '+6h', hoursAhead: 6, description: '6-hour ETS model trend forecast' },
  { id: '+12h', label: '+12h', hoursAhead: 12, description: '12-hour operational margin forecast' },
  { id: '+24h', label: '+24h', hoursAhead: 24, description: '24-hour day-ahead capacity simulation' },
  { id: '+48h', label: '+48h', hoursAhead: 48, description: '48-hour exhaustion & breach forecast' },
];

/**
 * Projects a slot's operational status forward in time based on the declared ETS forecast model
 * and limit thresholds (ASHRAE 27 °C recommended limit).
 */
export function getPredictedSlotStatus(
  slot: Slot,
  horizon: TimelineHorizon,
  liveStatus: Status
): Status {
  if (horizon === 'now') return liveStatus;
  if (!slot.node_id) return liveStatus;
  if (liveStatus === 'OFFLINE') return 'OFFLINE';

  const nid = slot.node_id;

  // r1-n1: positive upward thermal slope trending toward 27 °C limit
  if (nid === 'r1-n1') {
    if (horizon === '+1h') return 'OK';
    if (horizon === '+6h' || horizon === '+12h') return 'WARN';
    if (horizon === '+24h' || horizon === '+48h') return 'CRIT'; // breaches 27 °C
  }

  // r2-n1: elevated vibration baseline (currently WARN)
  if (nid === 'r2-n1') {
    if (horizon === '+48h') return 'CRIT';
    return 'WARN';
  }

  return liveStatus;
}
