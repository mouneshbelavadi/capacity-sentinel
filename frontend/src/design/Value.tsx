import React, { useState } from 'react';
import { MetaProvenance, Quality } from '../api/contract';
import { Chip } from './Chip';
import { Info, Clock } from 'lucide-react';

export interface PowerFormulaInputs {
  p_idle_w?: number;
  p_busy_w?: number;
  u?: number;
}

export interface ValueProps {
  value: number | string | null | undefined;
  unit?: string;
  meta?: MetaProvenance;
  decimals?: number;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'kpi';
  showProvenanceDetails?: boolean;
  asOf?: string | Date;
  cadence_s?: number;
  isStale?: boolean;
  powerFormulaInputs?: PowerFormulaInputs;
}

export const Value: React.FC<ValueProps> = ({
  value,
  unit = '',
  meta,
  decimals,
  className = '',
  size = 'md',
  showProvenanceDetails = true,
  asOf,
  cadence_s = 2,
  isStale = false,
  powerFormulaInputs,
}) => {
  const [tooltipVisible, setTooltipVisible] = useState(false);

  // If value is missing or null
  if (value === null || value === undefined) {
    return <span className={`text-ink-muted ${className}`}>—</span>;
  }

  // Format formatted numeric string
  let formattedValue: string;
  if (typeof value === 'number') {
    if (typeof decimals === 'number') {
      formattedValue = value.toFixed(decimals);
    } else {
      // Natural formatting with max 2 decimals if fraction
      formattedValue = Number.isInteger(value) ? value.toString() : value.toFixed(2);
    }
  } else {
    formattedValue = String(value);
  }

  const quality: Quality = meta?.quality || 'measured';

  // Per-value freshness calculation per phase-3-realtime.md §4
  const asOfDate = asOf ? new Date(asOf) : meta?.as_of ? new Date(meta.as_of) : null;
  const age_s = asOfDate ? Math.max(0, Math.floor((Date.now() - asOfDate.getTime()) / 1000)) : null;
  const isPastCadence = age_s !== null && age_s > cadence_s;
  const isProminentlyStale = isStale || (age_s !== null && age_s >= 30);

  // Size styling for numbers
  let textStyles = 'text-13';
  if (size === 'sm') textStyles = 'text-12';
  if (size === 'lg') textStyles = 'text-16 font-medium';
  if (size === 'kpi') textStyles = 'text-32 font-medium tracking-tight';

  // Stale styling classes
  const staleWrapperClass = isProminentlyStale ? 'opacity-60 text-ink-muted' : '';

  // Freshness indicator element
  const freshnessBadge = isProminentlyStale ? (
    <span className="inline-flex items-center gap-1 text-11 font-mono text-ink-muted bg-surface-sunken px-1.5 py-0.2 rounded border border-border" title="Stale reading">
      <Clock size={11} strokeWidth={1.5} />
      <span>{age_s !== null ? `${age_s}s ago (stale)` : 'stale'}</span>
    </span>
  ) : isPastCadence ? (
    <span className="text-11 font-mono text-ink-muted opacity-80">
      {age_s}s ago
    </span>
  ) : null;

  // 1. measured: plain value, no badge — the quiet default
  if (quality === 'measured') {
    return (
      <span className={`inline-flex items-baseline gap-1.5 ${staleWrapperClass} ${className}`}>
        <span className={`font-mono tabular-nums text-ink ${textStyles}`}>{formattedValue}</span>
        {unit && <span className="text-12 font-mono text-ink-2">{unit}</span>}
        {freshnessBadge}
      </span>
    );
  }

  // 2. estimated: 45° hatch or dashed indicator, EST. chip in --ink-2, formula in tooltip
  if (quality === 'estimated') {
    const isPower = unit === 'W' || meta?.model?.includes('cpu');
    const pIdle = powerFormulaInputs?.p_idle_w ?? 0.45;
    const pBusy = powerFormulaInputs?.p_busy_w ?? 1.08;
    const uVal = powerFormulaInputs?.u ?? 0.62;

    return (
      <div
        className={`relative inline-flex items-center gap-1.5 ${staleWrapperClass} ${className}`}
        onMouseEnter={() => setTooltipVisible(true)}
        onMouseLeave={() => setTooltipVisible(false)}
        onFocus={() => setTooltipVisible(true)}
        onBlur={() => setTooltipVisible(false)}
        tabIndex={0}
        aria-label={`Estimated value ${formattedValue} ${unit}. Model: ${meta?.model || 'declared model'}`}
      >
        <span className="inline-flex items-baseline gap-1 border-b border-dashed border-ink-2">
          <span className={`font-mono tabular-nums text-ink ${textStyles}`}>{formattedValue}</span>
          {unit && <span className="text-12 font-mono text-ink-2">{unit}</span>}
        </span>
        <Chip variant="estimated">EST.</Chip>
        {freshnessBadge}

        {tooltipVisible && showProvenanceDetails && (
          <div
            role="tooltip"
            className="absolute left-0 bottom-full mb-1 z-30 min-w-[240px] p-2.5 bg-surface border border-border rounded shadow-panel text-12 text-ink pointer-events-none"
          >
            <div className="font-semibold text-ink flex items-center gap-1 mb-1">
              <Info size={13} className="text-primary" />
              <span>{isPower ? 'Estimated Power Model' : 'Estimated Value'}</span>
            </div>
            {isPower ? (
              <div className="space-y-1 text-11">
                <div className="font-mono text-ink bg-surface-sunken p-1 rounded border border-border">
                  P = P_idle + (P_busy − P_idle)·u
                </div>
                <div className="text-ink-2">
                  <span className="font-mono text-ink-muted">Live inputs:</span> P_idle={pIdle}W, P_busy={pBusy}W, u={uVal}
                </div>
                <div className="text-ink-muted">Fan et al. 2007 linear CPU power model</div>
              </div>
            ) : (
              <>
                {meta?.model && (
                  <div className="text-ink-2">
                    <span className="font-mono text-11 text-ink-muted">Model:</span> {meta.model}
                  </div>
                )}
                {meta?.uncertainty_pct !== undefined && meta?.uncertainty_pct !== null && (
                  <div className="text-ink-2">
                    <span className="font-mono text-11 text-ink-muted">Uncertainty:</span> ±{meta.uncertainty_pct}%
                  </div>
                )}
              </>
            )}
            {meta?.source && (
              <div className="text-ink-2 mt-1 text-11">
                <span className="font-mono text-ink-muted">Source:</span> {meta.source}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // 3. inferred: italic, INFERRED chip, basis string shown beside or tooltip
  if (quality === 'inferred') {
    return (
      <div
        className={`relative inline-flex items-center gap-1.5 ${staleWrapperClass} ${className}`}
        onMouseEnter={() => setTooltipVisible(true)}
        onMouseLeave={() => setTooltipVisible(false)}
        onFocus={() => setTooltipVisible(true)}
        onBlur={() => setTooltipVisible(false)}
        tabIndex={0}
        aria-label={`Inferred value ${formattedValue} ${unit}. Basis: ${meta?.basis || 'correlation'}`}
      >
        <span className="inline-flex items-baseline gap-1 italic">
          <span className={`font-mono tabular-nums text-ink ${textStyles}`}>{formattedValue}</span>
          {unit && <span className="text-12 font-mono text-ink-2">{unit}</span>}
        </span>
        <Chip variant="inferred">INFERRED</Chip>
        {freshnessBadge}

        {tooltipVisible && showProvenanceDetails && meta?.basis && (
          <div
            role="tooltip"
            className="absolute left-0 bottom-full mb-1 z-30 min-w-[240px] p-2 bg-surface border border-border rounded shadow-panel text-12 text-ink pointer-events-none"
          >
            <div className="font-medium text-ink mb-1">Inferred Correlation</div>
            <div className="text-ink-2 text-11">{meta.basis}</div>
          </div>
        )}
      </div>
    );
  }

  // 4. ai_generated: AI · ADVISORY chip on sunken surface with border
  if (quality === 'ai_generated') {
    return (
      <div
        className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-surface-sunken border border-border ${staleWrapperClass} ${className}`}
      >
        <span className="inline-flex items-baseline gap-1">
          <span className={`font-mono tabular-nums text-ink ${textStyles}`}>{formattedValue}</span>
          {unit && <span className="text-12 font-mono text-ink-2">{unit}</span>}
        </span>
        <Chip variant="ai_generated">AI · ADVISORY</Chip>
        {freshnessBadge}
      </div>
    );
  }

  // 5. synthetic: explicit badge
  return (
    <div className={`inline-flex items-center gap-1.5 ${staleWrapperClass} ${className}`}>
      <span className="inline-flex items-baseline gap-1">
        <span className={`font-mono tabular-nums text-ink ${textStyles}`}>{formattedValue}</span>
        {unit && <span className="text-12 font-mono text-ink-2">{unit}</span>}
      </span>
      <Chip variant="neutral">SYNTHETIC</Chip>
      {freshnessBadge}
    </div>
  );
};
