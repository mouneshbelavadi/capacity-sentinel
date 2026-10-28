import React from 'react';
import { CategoryTab, CATEGORY_TABS } from './visualManagementTypes';
import { Layers, Thermometer, Activity, Wind, Zap } from 'lucide-react';

interface CategoryTabsProps {
  activeTab: CategoryTab;
  onSelectTab: (tab: CategoryTab) => void;
}

const TAB_ICONS: Record<CategoryTab, React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>> = {
  all: Layers,
  temperature: Thermometer,
  vibration: Activity,
  air_quality: Wind,
  power: Zap,
};

export const CategoryTabs: React.FC<CategoryTabsProps> = ({ activeTab, onSelectTab }) => {
  return (
    <div
      className="p-2 rounded-lg border border-border bg-surface flex flex-wrap items-center justify-between gap-2 shadow-xs"
      data-testid="category-tabs"
      role="tablist"
      aria-label="Filter 3D hall and telemetry by sensor category"
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-11 font-medium text-ink-2 uppercase tracking-wider px-2 hidden sm:inline">
          Filter View:
        </span>
        {CATEGORY_TABS.map((tab) => {
          const Icon = TAB_ICONS[tab.id];
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              type="button"
              onClick={() => onSelectTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-12 font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
                isActive
                  ? 'bg-primary text-white shadow-xs font-semibold'
                  : 'bg-surface-sunken border border-border/80 text-ink-2 hover:bg-surface-hover hover:text-ink'
              }`}
              title={tab.description}
            >
              <Icon size={13} strokeWidth={1.5} className={isActive ? 'text-white' : 'text-primary'} />
              <span>{tab.label}</span>
              {tab.id === 'power' && (
                <span
                  className={`text-9 uppercase px-1 py-0.2 rounded font-mono ${
                    isActive ? 'bg-white/20 text-white' : 'bg-surface border border-border text-ink-muted'
                  }`}
                >
                  est.
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="text-11 text-ink-muted hidden md:block pr-2">
        {CATEGORY_TABS.find((t) => t.id === activeTab)?.description}
      </div>
    </div>
  );
};

