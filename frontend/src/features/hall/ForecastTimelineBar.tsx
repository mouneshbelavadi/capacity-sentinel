import React from 'react';
import { TimelineHorizon, TIMELINE_STEPS } from './visualManagementTypes';
import { Chip } from '../../design/Chip';
import { Clock, Play, Pause, AlertOctagon, Activity, ChevronRight } from 'lucide-react';

interface ForecastTimelineBarProps {
  activeHorizon: TimelineHorizon;
  onChangeHorizon: (horizon: TimelineHorizon) => void;
  predictedBreaches?: number;
}

export const ForecastTimelineBar: React.FC<ForecastTimelineBarProps> = ({
  activeHorizon,
  onChangeHorizon,
  predictedBreaches = 0,
}) => {
  const [isPlaying, setIsPlaying] = React.useState(false);
  const playTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const activeHorizonRef = React.useRef<TimelineHorizon>(activeHorizon);
  activeHorizonRef.current = activeHorizon;

  const activeStep = TIMELINE_STEPS.find((s) => s.id === activeHorizon) || TIMELINE_STEPS[0];
  const isLive = activeHorizon === 'now';

  // Auto-play stepping through timeline
  React.useEffect(() => {
    if (isPlaying) {
      playTimerRef.current = setInterval(() => {
        const currentIndex = TIMELINE_STEPS.findIndex((s) => s.id === activeHorizonRef.current);
        const nextIndex = (currentIndex + 1) % TIMELINE_STEPS.length;
        onChangeHorizon(TIMELINE_STEPS[nextIndex].id);
      }, 2500);
    } else if (playTimerRef.current) {
      clearInterval(playTimerRef.current);
      playTimerRef.current = null;
    }

    return () => {
      if (playTimerRef.current) {
        clearInterval(playTimerRef.current);
      }
    };
  }, [isPlaying, onChangeHorizon]);

  return (
    <div
      className="p-3 rounded-lg border border-border bg-surface shadow-xs space-y-2.5"
      data-testid="forecast-timeline-bar"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        {/* Left: Mode Title & Live/Predicted Status */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-12 font-semibold text-ink">
            <Clock size={14} strokeWidth={1.5} className="text-primary" />
            <span>Timeline Horizon:</span>
          </div>

          {isLive ? (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-ok-weak/60 border border-ok/40 text-ok text-11 font-semibold font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-ok animate-pulse" />
              <span>LIVE TELEMETRY</span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-surface-sunken border border-border text-ink-2 text-11 font-mono font-medium">
              <Activity size={12} strokeWidth={1.5} className="text-primary" />
              <span>PREDICTED HORIZON ({activeHorizon})</span>
              <Chip variant="estimated">EST.</Chip>
            </span>
          )}

          {/* Predicted Breach Warning if future horizon has breaches */}
          {!isLive && predictedBreaches > 0 && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-crit-weak border border-crit/40 text-crit text-11 font-medium font-mono">
              <AlertOctagon size={12} strokeWidth={2} />
              <span>
                {predictedBreaches} Predicted Breach{predictedBreaches === 1 ? '' : 'es'}
              </span>
            </span>
          )}
        </div>

        {/* Right: Play/Pause simulation toggle & model basis note */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsPlaying(!isPlaying)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-11 font-medium transition-colors border ${
              isPlaying
                ? 'bg-primary text-white border-primary'
                : 'bg-surface-sunken hover:bg-surface-hover border-border text-ink-2'
            }`}
            title={isPlaying ? 'Pause forecast timeline simulation' : 'Auto-play forecast timeline simulation'}
          >
            {isPlaying ? (
              <>
                <Pause size={12} strokeWidth={2} />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play size={12} strokeWidth={2} />
                <span>Simulate</span>
              </>
            )}
          </button>
          <span className="text-11 text-ink-muted hidden md:inline">
            Model: <span className="font-mono text-ink-2">ETS damped additive</span>
          </span>
        </div>
      </div>

      {/* Timeline Steps Buttons Row */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
        {TIMELINE_STEPS.map((step, idx) => {
          const isSelected = activeHorizon === step.id;
          return (
            <React.Fragment key={step.id}>
              <button
                type="button"
                onClick={() => {
                  setIsPlaying(false);
                  onChangeHorizon(step.id);
                }}
                className={`flex-1 min-w-[76px] py-1.5 px-2 rounded-md text-center text-11 font-mono transition-all border ${
                  isSelected
                    ? 'bg-primary text-white font-bold border-primary shadow-xs'
                    : 'bg-surface-sunken hover:bg-surface-hover text-ink border-border/80'
                }`}
                title={step.description}
                aria-pressed={isSelected}
              >
                <div className="leading-tight">{step.label}</div>
              </button>
              {idx < TIMELINE_STEPS.length - 1 && (
                <ChevronRight size={12} strokeWidth={1.5} className="text-border-strong shrink-0 hidden sm:block" />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Description subtitle */}
      <div className="text-11 text-ink-muted flex items-center justify-between">
        <span>{activeStep.description}</span>
        {!isLive && (
          <span className="font-mono text-10 text-ink-2">
            P10 / Median / P90 confidence cone evaluated
          </span>
        )}
      </div>
    </div>
  );
};
