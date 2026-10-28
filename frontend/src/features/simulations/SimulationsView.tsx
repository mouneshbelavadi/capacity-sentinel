import React, { useState, useEffect } from 'react';
import { apiClient, ApiClientError } from '../../api/client';
import { Proposal } from '../../api/contract';
import { StatusBadge } from '../../design/StatusBadge';
import { stripEmojis } from '../proposals/ProposalCard';
import { EvidenceModal } from '../ai/EvidenceModal';
import {
  PlayCircle,
  Activity,
  CheckCircle2,
  Sparkles,
  Send,
  ArrowRight,
  RefreshCw,
  Thermometer,
  Zap,
  Wind,
  Shield,
} from 'lucide-react';

export interface SimulationScenario {
  id: string;
  title: string;
  category: 'temperature' | 'vibration' | 'air_quality' | 'power' | 'recovery';
  severity: 'OK' | 'WARN' | 'CRIT';
  target_rack: string;
  target_bay: string;
  target_node: string;
  tenant: string;
  description: string;
  metric: string;
  unit: string;
  baseline_val: string;
  simulated_val: string;
  delta: string;
}

export interface SimulationRunResult {
  scenario_id: string;
  status: string;
  scenario: SimulationScenario;
  points_injected: number;
  summary: string;
  proposal: Proposal | null;
  timestamp: string;
}

export interface SimulationsViewProps {
  onNavigateToHall?: () => void;
  onNavigateToApprovals?: () => void;
}

const DEFAULT_SCENARIOS: SimulationScenario[] = [
  {
    id: 'thermal_breach',
    title: 'Thermal Breach (ASHRAE TC9.9 Breach)',
    category: 'temperature',
    severity: 'CRIT',
    target_rack: 'rack-01',
    target_bay: 'U12–U15',
    target_node: 'r1-n1',
    tenant: 'Beta Compute',
    description: 'Inlet temperature climbs from 24.6 °C to 28.2 °C, violating the ASHRAE TC9.9 Recommended 27.0 °C upper envelope limit.',
    metric: 't_c',
    unit: '°C',
    baseline_val: '24.6 °C',
    simulated_val: '28.2 °C',
    delta: '+3.6 °C',
  },
  {
    id: 'fan_vibration',
    title: 'Cooling Fan Bearing Degradation',
    category: 'vibration',
    severity: 'WARN',
    target_rack: 'rack-02',
    target_bay: 'U10–U13',
    target_node: 'r2-n1',
    tenant: 'Beta Compute',
    description: 'MPU6050 vibration RMS surges from 0.02g baseline to 0.092g (4.6x baseline), triggering a mechanical bearing failure warning.',
    metric: 'vib_rms_g',
    unit: 'g',
    baseline_val: '0.02 g',
    simulated_val: '0.092 g',
    delta: '4.6x baseline',
  },
  {
    id: 'air_stagnation',
    title: 'Exhaust Air Recirculation & Stagnation',
    category: 'air_quality',
    severity: 'WARN',
    target_rack: 'rack-01',
    target_bay: 'U18–U21',
    target_node: 'r1-n2',
    tenant: 'Alpha Systems',
    description: 'MQ135 exhaust air ratio jumps from 1.05 to 2.85, indicating hot-air recirculation around containment seals.',
    metric: 'mq_ratio',
    unit: 'ratio',
    baseline_val: '1.05 ratio',
    simulated_val: '2.85 ratio',
    delta: '+1.80 ratio',
  },
  {
    id: 'compute_surge',
    title: 'High-Density AI Compute Load Surge',
    category: 'power',
    severity: 'CRIT',
    target_rack: 'rack-01',
    target_bay: 'U12–U15',
    target_node: 'r1-n1',
    tenant: 'Alpha Systems',
    description: 'Tenant workload bursts to 96% utilization, driving estimated power from 1.08 kW to 3.85 kW and tightening thermal exhaustion ETA.',
    metric: 'power_w',
    unit: 'W',
    baseline_val: '1,080 W',
    simulated_val: '3,850 W',
    delta: '+2,770 W',
  },
  {
    id: 'nominal_recovery',
    title: 'Facility Normal Baseline Recovery',
    category: 'recovery',
    severity: 'OK',
    target_rack: 'rack-01',
    target_bay: 'All Bays',
    target_node: 'r1-n1, r2-n1',
    tenant: 'All Tenants',
    description: 'Restores environmental operating points to nominal healthy baselines across all monitored server racks.',
    metric: 'all',
    unit: 'baseline',
    baseline_val: 'Nominal',
    simulated_val: '24.5 °C / 0.02g',
    delta: '0.0 (Healthy)',
  },
];

export const SimulationsView: React.FC<SimulationsViewProps> = ({
  onNavigateToHall,
  onNavigateToApprovals,
}) => {
  const [scenarios, setScenarios] = useState<SimulationScenario[]>(DEFAULT_SCENARIOS);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [activeResult, setActiveResult] = useState<SimulationRunResult | null>(null);
  const [activeProposal, setActiveProposal] = useState<Proposal | null>(null);
  const [chatMessage, setChatMessage] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState<Array<{ sender: 'human' | 'ai'; text: string; ts: string }>>([]);
  const [activeEvidenceId, setActiveEvidenceId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    // Load simulation scenarios catalog from backend
    apiClient
      .get<SimulationScenario[]>('/api/simulations')
      .then((data) => {
        if (data && data.length > 0) setScenarios(data);
      })
      .catch(() => {
        // Keep default scenarios if offline
      });
  }, []);

  const handleRunSimulation = async (scenarioId: string) => {
    setRunningId(scenarioId);
    setErrorMessage(null);
    try {
      const res = await apiClient.post<SimulationRunResult>('/api/simulations/run', {
        scenario_id: scenarioId,
      });
      setActiveResult(res);
      setActiveProposal(res.proposal);
      setChatHistory([]);
    } catch (err) {
      setErrorMessage(
        err instanceof ApiClientError ? err.message : 'Simulation execution failed'
      );
    } finally {
      setRunningId(null);
    }
  };

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim() || chatLoading) return;

    const userText = chatMessage.trim();
    setChatMessage('');
    setChatLoading(true);

    const userMsg = {
      sender: 'human' as const,
      text: userText,
      ts: new Date().toLocaleTimeString(),
    };
    setChatHistory((prev) => [...prev, userMsg]);

    try {
      const payload: Record<string, unknown> = {
        message: userText,
      };
      if (activeProposal?.proposal_id) {
        payload.proposal_id = activeProposal.proposal_id;
      } else if (activeResult?.scenario?.target_node) {
        payload.node_id = activeResult.scenario.target_node.split(',')[0].trim();
      }

      const res = await apiClient.post<{ reply: string; proposal_revision?: Proposal }>(
        '/api/ai/chat',
        payload
      );

      const aiMsg = {
        sender: 'ai' as const,
        text: stripEmojis(res.reply || 'Understood. Operational constraints reviewed.'),
        ts: new Date().toLocaleTimeString(),
      };
      setChatHistory((prev) => [...prev, aiMsg]);

      if (res.proposal_revision) {
        setActiveProposal({
          ...res.proposal_revision,
          status: 'DISCUSSING',
        });
      }
    } catch (err) {
      setChatHistory((prev) => [
        ...prev,
        {
          sender: 'ai',
          text: err instanceof ApiClientError ? err.message : 'AI Advisory service unreachable.',
          ts: new Date().toLocaleTimeString(),
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleSwitchOption = async (option: { action: string; label: string; rationale: string }) => {
    const promptText = `Switch mitigation action to: ${option.action}. Rationale: ${option.rationale}`;
    setChatMessage(promptText);
    setChatLoading(true);

    const userMsg = {
      sender: 'human' as const,
      text: `Switch to ${option.label}`,
      ts: new Date().toLocaleTimeString(),
    };
    setChatHistory((prev) => [...prev, userMsg]);

    try {
      const res = await apiClient.post<{ reply: string; proposal_revision?: Proposal }>(
        '/api/ai/chat',
        {
          proposal_id: activeProposal?.proposal_id,
          node_id: activeResult?.scenario?.target_node?.split(',')[0].trim(),
          message: promptText,
        }
      );

      setChatHistory((prev) => [
        ...prev,
        {
          sender: 'ai',
          text: stripEmojis(res.reply || `Proposal action updated to ${option.action}.`),
          ts: new Date().toLocaleTimeString(),
        },
      ]);

      if (res.proposal_revision) {
        setActiveProposal(res.proposal_revision);
      }
    } catch {
      // ignore
    } finally {
      setChatLoading(false);
    }
  };

  const getCategoryIcon = (cat: string) => {
    switch (cat) {
      case 'temperature':
        return <Thermometer size={14} className="text-crit" />;
      case 'vibration':
        return <Activity size={14} className="text-warn" />;
      case 'air_quality':
        return <Wind size={14} className="text-warn" />;
      case 'power':
        return <Zap size={14} className="text-primary" />;
      default:
        return <CheckCircle2 size={14} className="text-ok" />;
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header Banner */}
      <div className="bg-surface border border-border rounded-lg p-5 shadow-card flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-primary-weak text-primary flex items-center justify-center">
              <PlayCircle size={18} strokeWidth={1.5} />
            </div>
            <h1 className="text-16 font-bold text-ink">Multi-Scenario Facility Simulation Engine</h1>
          </div>
          <p className="text-12 text-ink-2 mt-1.5 max-w-3xl leading-relaxed">
            Execute realistic operational stress tests, thermal breaches, and mechanical vibration regime shifts.
            Simulations inject calibrated sensor deltas into the live SQLite telemetry stream, trigger automated
            CUSUM+PELT changepoints, and automatically generate grounded AI advisory suggestions with multi-option discussion.
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded bg-surface-sunken border border-border text-11 font-mono text-ink-2">
          <Shield size={13} className="text-ok" />
          <span>No Fake Data — Explicit Synthetic Quality</span>
        </div>
      </div>

      {/* Error state */}
      {errorMessage && (
        <div className="p-3 rounded border border-crit/30 bg-crit-weak text-crit text-12 font-medium">
          {errorMessage}
        </div>
      )}

      {/* Scenarios Grid */}
      <div className="space-y-3">
        <h2 className="text-13 font-bold uppercase tracking-wider text-ink-muted">
          Available Simulation Scenarios ({scenarios.length})
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {scenarios.map((sc) => {
            const isRunning = runningId === sc.id;
            const isSelected = activeResult?.scenario_id === sc.id;

            return (
              <div
                key={sc.id}
                className={`bg-surface border rounded-lg p-4 space-y-3 transition-all shadow-card flex flex-col justify-between ${
                  isSelected ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-border-strong'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-bold text-12 text-ink">
                      {getCategoryIcon(sc.category)}
                      <span>{sc.title}</span>
                    </div>
                    <StatusBadge status={sc.severity} size="sm" />
                  </div>

                  <p className="text-11 text-ink-2 mt-2 leading-relaxed">
                    {sc.description}
                  </p>

                  <div className="mt-3 pt-3 border-t border-border/80 space-y-1 text-11">
                    <div className="flex justify-between">
                      <span className="text-ink-muted">Target:</span>
                      <span className="font-semibold text-ink">{sc.target_rack} • {sc.target_bay}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink-muted">Node / Tenant:</span>
                      <span className="font-mono text-primary font-bold">{sc.target_node} ({sc.tenant})</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink-muted">Metric Delta:</span>
                      <span className="font-mono font-bold text-crit">{sc.baseline_val} ➔ {sc.simulated_val} ({sc.delta})</span>
                    </div>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    disabled={isRunning}
                    onClick={() => handleRunSimulation(sc.id)}
                    className="w-full py-2 px-3 rounded bg-primary hover:bg-primary-hover text-surface text-12 font-semibold transition-colors flex items-center justify-center gap-1.5 shadow-xs disabled:opacity-60"
                  >
                    {isRunning ? (
                      <>
                        <RefreshCw size={13} className="animate-spin" />
                        <span>Injecting Telemetry & Generating AI...</span>
                      </>
                    ) : (
                      <>
                        <PlayCircle size={14} />
                        <span>Run Simulation</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Active Simulation Results & AI Chat Console */}
      {activeResult && (
        <div className="space-y-4 pt-4 border-t border-border">
          {/* Result Execution Headline */}
          <div className="p-4 rounded-lg bg-surface border-2 border-primary/40 space-y-2 shadow-panel">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-13 font-bold text-ink">
                <CheckCircle2 size={16} className="text-ok" />
                <span>Simulation Executed: {activeResult.scenario.title}</span>
              </div>
              <span className="text-11 font-mono text-ink-muted">{activeResult.timestamp}</span>
            </div>
            <p className="text-12 text-ink leading-relaxed">
              {activeResult.summary}
            </p>
            <div className="flex items-center gap-3 pt-2 text-11">
              <button
                type="button"
                onClick={onNavigateToHall}
                className="text-primary hover:underline font-semibold flex items-center gap-1"
              >
                <span>View affected bay in 3D Hall</span>
                <ArrowRight size={12} />
              </button>
              {activeProposal && onNavigateToApprovals && (
                <button
                  type="button"
                  onClick={onNavigateToApprovals}
                  className="text-primary hover:underline font-semibold flex items-center gap-1"
                >
                  <span>Open in Facility Approvals</span>
                  <ArrowRight size={12} />
                </button>
              )}
            </div>
          </div>

          {/* AI Advisory & Chat Suggestion Box */}
          {activeProposal && (
            <div className="bg-surface border border-border rounded-lg p-5 shadow-panel space-y-4">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded bg-primary-weak text-primary flex items-center justify-center">
                    <Sparkles size={16} strokeWidth={1.5} />
                  </div>
                  <div>
                    <h3 className="text-13 font-bold text-ink">Automated AI Advisory Mitigation</h3>
                    <p className="text-11 text-ink-muted">OWASP LLM06 Grounded Recommendation • Discussion Supported</p>
                  </div>
                </div>
                <span className="px-2.5 py-0.5 rounded bg-warn-weak border border-warn/40 text-warn font-bold text-11">
                  Risk Tier: {activeProposal.risk_tier}
                </span>
              </div>

              {/* Proposal Recommendation Details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-12">
                <div className="space-y-1">
                  <span className="text-11 font-semibold text-ink-muted uppercase tracking-wider">Primary Recommendation</span>
                  <div className="text-14 font-mono font-bold text-primary bg-primary-weak/40 p-2 rounded border border-primary/20">
                    {activeProposal.action} (Target: {activeProposal.target})
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-11 font-semibold text-ink-muted uppercase tracking-wider">Expected Operational Effect</span>
                  <div className="text-12 font-mono text-ink bg-surface-sunken p-2 rounded border border-border">
                    {activeProposal.expected_effect}
                  </div>
                </div>
              </div>

              <div>
                <span className="text-11 font-semibold text-ink-muted uppercase tracking-wider">Operational Rationale</span>
                <p className="text-12 text-ink mt-1 bg-surface-sunken p-2.5 rounded border border-border leading-relaxed">
                  {stripEmojis(activeProposal.rationale)}
                </p>
              </div>

              {/* Multi-Option Suggestion Alternatives */}
              {activeProposal.alternative_options && activeProposal.alternative_options.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-border">
                  <div className="text-11 font-bold text-ink-muted uppercase tracking-wider">
                    Alternative Mitigation Choices (Click to switch recommendation):
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {activeProposal.alternative_options.map((opt, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => handleSwitchOption(opt)}
                        disabled={chatLoading}
                        className="p-2.5 text-left rounded border border-border bg-surface-sunken hover:bg-surface-hover hover:border-primary/40 transition-all text-11 space-y-1 shadow-2xs"
                      >
                        <div className="font-bold text-ink">{opt.label}</div>
                        <div className="text-10 text-ink-2 line-clamp-2">{opt.rationale}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Interactive AI Chat Section */}
              <div className="pt-3 border-t border-border space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-12 font-bold text-ink">
                    <Sparkles size={14} className="text-primary" />
                    <span>Chat with AI Advisory for Custom Changes</span>
                  </div>
                  <span className="text-10 font-mono text-ink-muted">Audit-logged discussion</span>
                </div>

                {/* Chat History */}
                {chatHistory.length > 0 && (
                  <div className="space-y-2 max-h-56 overflow-y-auto p-3 bg-surface-sunken border border-border rounded-lg text-12">
                    {chatHistory.map((msg, idx) => (
                      <div
                        key={idx}
                        className={`p-2 rounded-lg max-w-[85%] space-y-1 ${
                          msg.sender === 'human'
                            ? 'ml-auto bg-primary text-white'
                            : 'mr-auto bg-surface border border-border text-ink'
                        }`}
                      >
                        <div className="flex items-center justify-between text-10 gap-3 opacity-80">
                          <span className="font-semibold">{msg.sender === 'human' ? 'Operator' : 'AI Advisory'}</span>
                          <span>{msg.ts}</span>
                        </div>
                        <div className="text-11 leading-relaxed">{msg.text}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Chat Input */}
                <form onSubmit={handleChatSubmit} className="flex gap-2">
                  <input
                    type="text"
                    value={chatMessage}
                    onChange={(e) => setChatMessage(e.target.value)}
                    placeholder="Ask AI about alternatives (e.g. 'What if we increase cooling instead of migrating?')..."
                    disabled={chatLoading}
                    className="flex-1 px-3 py-2 text-12 rounded border border-border bg-surface text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={chatLoading || !chatMessage.trim()}
                    className="px-4 py-2 rounded bg-primary hover:bg-primary-hover text-surface text-12 font-semibold transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <Send size={13} />
                    <span>{chatLoading ? 'Thinking...' : 'Send'}</span>
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Evidence Viewer Modal */}
      {activeEvidenceId && (
        <EvidenceModal
          evidenceId={activeEvidenceId}
          onClose={() => setActiveEvidenceId(null)}
        />
      )}
    </div>
  );
};
