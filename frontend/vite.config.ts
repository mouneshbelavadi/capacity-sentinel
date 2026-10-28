import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { WebSocketServer, WebSocket } from 'ws';

function devApiPlugin(): Plugin {
  return {
    name: 'racksense-dev-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api')) {
          return next();
        }

        const urlObj = new URL(req.url, 'http://localhost:5173');
        const pathname = urlObj.pathname;
        const auth = (req.headers['authorization'] as string) || '';
        const isTenant = auth.includes('tenant');
        const isSuperUser = auth.includes('superuser');

        // GET /api/meta
        if (pathname === '/api/meta' && req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              contract_version: '1.0.0',
              server_time: new Date().toISOString(),
              site_id: 'site-01',
            })
          );
          return;
        }

        // POST /api/auth/login
        if (pathname === '/api/auth/login' && req.method === 'POST') {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });
          req.on('end', () => {
            try {
              const { username } = JSON.parse(body || '{}');
              let role = 'OPERATOR';
              let tenant_id: string | null = null;
              let display_name = 'Operator Mounesh';

              if (username === 'tenant' || username === 't-beta') {
                role = 'TENANT';
                tenant_id = 't-beta';
                display_name = 'Beta Compute (Tenant)';
              } else if (username === 'superuser') {
                role = 'SUPER_USER';
                tenant_id = null;
                display_name = 'Super User Mounesh';
              }

              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  access_token: `token-${role.toLowerCase()}-session`,
                  token_type: 'bearer',
                  expires_in: 3600,
                  role,
                  tenant_id,
                  display_name,
                })
              );
            } catch {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Invalid credentials payload',
                  },
                })
              );
            }
          });
          return;
        }

        // GET /api/auth/me
        if (pathname === '/api/auth/me' && req.method === 'GET') {
          let role = 'OPERATOR';
          let tenant_id: string | null = null;
          let display_name = 'Operator Mounesh';

          if (isTenant) {
            role = 'TENANT';
            tenant_id = 't-beta';
            display_name = 'Beta Compute (Tenant)';
          } else if (isSuperUser) {
            role = 'SUPER_USER';
            tenant_id = null;
            display_name = 'Super User Mounesh';
          }

          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              user_id: `${role.toLowerCase()}-user`,
              role,
              tenant_id,
              display_name,
            })
          );
          return;
        }

        // GET /api/topology
        if (pathname === '/api/topology' && req.method === 'GET') {
          // Master physical racks topology
          const masterRacks = [
            {
              rack_id: 'rack-01',
              label: 'Rack 01',
              position: { row: 0, col: 0 },
              slots: [
                {
                  slot_id: 'rack-01-u12',
                  u_start: 12,
                  u_height: 4,
                  tenant_id: 't-alpha',
                  tenant_label: 'Alpha Systems',
                  node_id: 'r1-n1',
                  status: 'OK' as const,
                },
                {
                  slot_id: 'rack-01-u18',
                  u_start: 18,
                  u_height: 4,
                  tenant_id: 't-beta',
                  tenant_label: 'Beta Compute',
                  node_id: 'r1-n2',
                  status: 'OK' as const,
                },
                {
                  slot_id: 'rack-01-u26',
                  u_start: 26,
                  u_height: 4,
                  tenant_id: null,
                  tenant_label: null,
                  node_id: null,
                  status: 'OFFLINE' as const,
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
                  u_height: 4,
                  tenant_id: 't-beta',
                  tenant_label: 'Beta Compute',
                  node_id: 'r2-n1',
                  status: 'WARN' as const,
                },
                {
                  slot_id: 'rack-02-u16',
                  u_start: 16,
                  u_height: 4,
                  tenant_id: 't-alpha',
                  tenant_label: 'Alpha Systems',
                  node_id: 'r2-n2',
                  status: 'OK' as const,
                },
                {
                  slot_id: 'rack-02-u24',
                  u_start: 24,
                  u_height: 4,
                  tenant_id: 't-beta',
                  tenant_label: 'Beta Compute',
                  node_id: 'r2-n3',
                  status: 'OK' as const,
                },
              ],
            },
          ];

          // Server-side tenant scoping per shared/tenant-isolation.md §4:
          // A tenant receives full rack geometry, but foreign slots have
          // tenant_id: null, tenant_label: null, node_id: null, status: 'UNKNOWN'
          const scopedRacks = masterRacks.map((rack) => ({
            ...rack,
            slots: rack.slots.map((slot) => {
              if (isTenant && slot.tenant_id !== 't-beta') {
                return {
                  slot_id: slot.slot_id,
                  u_start: slot.u_start,
                  u_height: slot.u_height,
                  tenant_id: null,
                  tenant_label: null,
                  node_id: null,
                  status: 'UNKNOWN' as const,
                };
              }
              return slot;
            }),
          }));

          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              site_id: 'site-01',
              racks: scopedRacks,
            })
          );
          return;
        }

        // GET /api/racks/:rack_id/summary
        const rackSummaryMatch = pathname.match(/^\/api\/racks\/([^/]+)\/summary$/);
        if (rackSummaryMatch && req.method === 'GET') {
          const rackId = rackSummaryMatch[1];
          const now = new Date().toISOString();

          let summary;
          if (rackId === 'rack-01') {
            summary = {
              rack_id: 'rack-01',
              status: 'OK',
              worst_margin: {
                metric: 't_c',
                node_id: isTenant ? 'r1-n2' : 'r1-n1',
                value: {
                  value: 24.61,
                  unit: '°C',
                  meta: {
                    quality: 'measured',
                    source: isTenant ? 'node:r1-n2:dht22' : 'node:r1-n1:dht22',
                    as_of: now,
                  },
                },
                limit: 27.0,
                limit_source: 'ASHRAE TC9.9 recommended inlet upper',
              },
              nodes_online: isTenant ? 1 : 2,
              nodes_total: isTenant ? 1 : 2,
            };
          } else {
            summary = {
              rack_id: 'rack-02',
              status: 'WARN',
              worst_margin: {
                metric: 'vib_rms_g',
                node_id: 'r2-n1',
                value: {
                  value: 0.024,
                  unit: 'g',
                  meta: {
                    quality: 'measured',
                    source: 'node:r2-n1:mpu6050',
                    as_of: now,
                  },
                },
                limit: 0.02,
                limit_source: 'Baseline 2x WARN threshold (commissioning)',
              },
              nodes_online: isTenant ? 2 : 3,
              nodes_total: isTenant ? 2 : 3,
            };
          }

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(summary));
          return;
        }

        // GET /api/nodes/:node_id/telemetry
        const nodeTelemetryMatch = pathname.match(/^\/api\/nodes\/([^/]+)\/telemetry$/);
        if (nodeTelemetryMatch && req.method === 'GET') {
          const nodeId = nodeTelemetryMatch[1];
          const foreignNodes = ['r1-n1', 'r2-n2'];

          // Server-side isolation test:
          // A tenant querying a foreign node gets 404 NOT_FOUND, never 403.
          if (isTenant && foreignNodes.includes(nodeId)) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: {
                  code: 'NOT_FOUND',
                  message: "That node isn't in your view.",
                },
              })
            );
            return;
          }

          const metric = (urlObj.searchParams.get('metric') || 't_c') as string;
          const now = new Date().toISOString();

          // Special case: MQ135 warming up test
          if (metric === 'mq_ratio' && nodeId === 'r2-n3') {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: {
                  code: 'SENSOR_WARMING_UP',
                  message: 'Warming up — the MQ135 needs its preheat before any reading is meaningful.',
                },
              })
            );
            return;
          }

          // Generate telemetry points
          let val = 24.61;
          let unit = '°C';
          let quality: 'measured' | 'estimated' = 'measured';
          let source = `node:${nodeId}:dht22`;

          if (metric === 'rh') {
            val = 42.1;
            unit = '%';
          } else if (metric === 'dew_c') {
            val = 11.2;
            unit = '°C';
          } else if (metric === 'mq_ratio') {
            val = 1.45;
            unit = 'ratio';
            source = `node:${nodeId}:mq135`;
          } else if (metric === 'vib_rms_g') {
            val = 0.024;
            unit = 'g';
            source = `node:${nodeId}:mpu6050`;
          } else if (metric === 'vib_crest') {
            val = 3.2;
            unit = 'ratio';
            source = `node:${nodeId}:mpu6050`;
          } else if (metric === 'shock_count') {
            val = 0;
            unit = 'count';
            source = `node:${nodeId}:sw420`;
          } else if (metric === 'power_w') {
            val = 1.08;
            unit = 'W';
            quality = 'estimated';
            source = 'linear-cpu-v1';
          }

          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              node_id: nodeId,
              metric,
              unit,
              step_s: 10,
              points: [
                { ts: new Date(Date.now() - 30000).toISOString(), value: val - 0.2 },
                { ts: new Date(Date.now() - 20000).toISOString(), value: val - 0.1 },
                { ts: new Date(Date.now() - 10000).toISOString(), value: val },
                { ts: now, value: val },
              ],
              meta: {
                quality,
                source,
                as_of: now,
              },
            })
          );
          return;
        }

        // GET /api/tenants (SUPER_USER only)
        if (pathname === '/api/tenants' && req.method === 'GET') {
          if (!isSuperUser) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: {
                  code: 'NOT_FOUND',
                  message: 'Resource not found',
                },
              })
            );
            return;
          }

          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              tenants: [
                {
                  tenant_id: 't-alpha',
                  label: 'Alpha Systems',
                  slot_count: 2,
                  contact: 'noc@alpha-systems.example',
                },
                {
                  tenant_id: 't-beta',
                  label: 'Beta Compute',
                  slot_count: 3,
                  contact: 'ops@betacompute.example',
                },
              ],
            })
          );
          return;
        }

        // GET /api/forecast/:node_id/:metric
        const forecastMatch = pathname.match(/^\/api\/forecast\/([^/]+)\/([^/]+)$/);
        if (forecastMatch && req.method === 'GET') {
          const nodeId = forecastMatch[1];
          const metric = forecastMatch[2];
          const foreignNodes = ['r1-n1', 'r2-n2'];

          if (isTenant && foreignNodes.includes(nodeId)) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: {
                  code: 'NOT_FOUND',
                  message: "That node isn't in your view.",
                },
              })
            );
            return;
          }

          if (nodeId === 'r2-n3') {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: {
                  code: 'FORECAST_INSUFFICIENT_DATA',
                  message: 'Not enough history yet. Forecasting starts after ~5 minutes of readings.',
                },
              })
            );
            return;
          }

          const now = Date.now();
          const hasTrend = nodeId !== 'r2-n2';

          const history = [
            { ts: new Date(now - 180000).toISOString(), value: 24.1 },
            { ts: new Date(now - 120000).toISOString(), value: 24.5 },
            { ts: new Date(now - 60000).toISOString(), value: 25.0 },
            { ts: new Date(now).toISOString(), value: 25.4 },
          ];

          const median = hasTrend
            ? [
                { ts: new Date(now).toISOString(), value: 25.4 },
                { ts: new Date(now + 120000).toISOString(), value: 25.9 },
                { ts: new Date(now + 240000).toISOString(), value: 26.5 },
                { ts: new Date(now + 360000).toISOString(), value: 27.0 },
                { ts: new Date(now + 480000).toISOString(), value: 27.6 },
              ]
            : [
                { ts: new Date(now).toISOString(), value: 24.2 },
                { ts: new Date(now + 120000).toISOString(), value: 24.2 },
                { ts: new Date(now + 240000).toISOString(), value: 24.3 },
                { ts: new Date(now + 360000).toISOString(), value: 24.2 },
              ];

          const p10 = hasTrend
            ? [
                { ts: new Date(now).toISOString(), value: 25.4 },
                { ts: new Date(now + 120000).toISOString(), value: 25.6 },
                { ts: new Date(now + 240000).toISOString(), value: 26.0 },
                { ts: new Date(now + 360000).toISOString(), value: 26.4 },
                { ts: new Date(now + 480000).toISOString(), value: 26.8 },
              ]
            : [];

          const p90 = hasTrend
            ? [
                { ts: new Date(now).toISOString(), value: 25.4 },
                { ts: new Date(now + 120000).toISOString(), value: 26.3 },
                { ts: new Date(now + 240000).toISOString(), value: 27.2 },
                { ts: new Date(now + 360000).toISOString(), value: 27.8 },
                { ts: new Date(now + 480000).toISOString(), value: 28.5 },
              ]
            : [];

          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              forecast_id: `fc_${nodeId}_001`,
              node_id: nodeId,
              metric,
              limit: 27.0,
              limit_source: 'ASHRAE TC9.9 recommended inlet upper bound',
              model: 'ets_damped_additive',
              window_start: new Date(now - 180000).toISOString(),
              window_reason: nodeId === 'r1-n1' ? 'changepoint:cp_0042' : 'rolling_30m',
              horizon_s: 7200,
              history,
              median,
              p10,
              p90,
              crossing: {
                has_trend: hasTrend,
                p10_s: hasTrend ? 180 : null,
                p50_s: hasTrend ? 360 : null,
                p90_s: hasTrend ? 660 : null,
                no_breach_fraction: hasTrend ? 0.12 : 0.94,
              },
              slope: {
                value: hasTrend ? 0.014 : 0.001,
                unit: '°C/s',
                ci_low: hasTrend ? 0.009 : -0.004,
                ci_high: hasTrend ? 0.019 : 0.006,
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
                as_of: new Date().toISOString(),
              },
            })
          );
          return;
        }

        // GET /api/attribution/:rack_id
        const attrMatch = pathname.match(/^\/api\/attribution\/([^/]+)$/);
        if (attrMatch && req.method === 'GET') {
          const rackId = attrMatch[1];
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              rack_id: rackId,
              metric: 't_c',
              contributors: [
                {
                  tenant_id: 't-beta',
                  tenant_label: 'Beta Compute',
                  share: 0.71,
                  basis: 'slope increased 3.1x within 40s of tenant node r2-n1 coming online',
                  meta: { quality: 'inferred', as_of: new Date().toISOString() },
                },
                {
                  tenant_id: 't-alpha',
                  tenant_label: 'Alpha Systems',
                  share: 0.29,
                  basis: 'steady baseline thermal envelope from slot U12',
                  meta: { quality: 'inferred', as_of: new Date().toISOString() },
                },
              ],
            })
          );
          return;
        }

        // GET /api/power/:node_id
        const powerMatch = pathname.match(/^\/api\/power\/([^/]+)$/);
        if (powerMatch && req.method === 'GET') {
          const nodeId = powerMatch[1];
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              node_id: nodeId,
              value: {
                value: 1.08,
                unit: 'W',
                meta: {
                  quality: 'estimated',
                  source: 'model',
                  model: 'linear-cpu-v1',
                  uncertainty_pct: 30,
                  as_of: new Date().toISOString(),
                },
              },
              model_detail: {
                formula: 'P = P_idle + (P_busy − P_idle)·u',
                p_idle_w: 0.45,
                p_busy_w: 1.4,
                u: 0.62,
                calibrated: false,
                reference: 'Fan, Weber & Barroso (ISCA 2007); UNO Q idle/load figures from independent bench tests',
              },
            })
          );
          return;
        }

        // GET /api/changepoints
        if (pathname === '/api/changepoints' && req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              changepoints: [
                {
                  cp_id: 'cp_0042',
                  node_id: 'r1-n1',
                  metric: 't_c',
                  detected_at: new Date(Date.now() - 120000).toISOString(),
                  located_at: new Date(Date.now() - 180000).toISOString(),
                  detector: 'cusum+pelt',
                  confirmed: true,
                  shift: { before_mean: 23.9, after_mean: 25.4, delta: 1.5 },
                  topology_event: { type: 'node_online', node_id: 'r2-n1' },
                  meta: { quality: 'measured', as_of: new Date().toISOString() },
                },
              ],
            })
          );
          return;
        }

        // ==========================================
        // Phase 6: AI, Proposals & Audit Endpoints
        // ==========================================

        // POST /api/ai/summarize
        if (pathname === '/api/ai/summarize' && req.method === 'POST') {
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              text: 'Inlet temperature is approaching the ASHRAE 27.0 °C upper recommended limit following a 1.5 °C shift on node r1-n1. Extrapolation projects threshold breach within 6 minutes under sustained workload.',
              status_hint: 'WARN',
              evidence: ['fc_0193', 'cp_0042'],
              meta: {
                quality: 'ai_generated',
                model: 'gemini-1.5-pro',
                as_of: new Date().toISOString(),
              },
            })
          );
          return;
        }

        // POST /api/ai/explain
        if (pathname === '/api/ai/explain' && req.method === 'POST') {
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              text: 'The ETS damped additive model fitted a sustained slope of +0.014 °C/s following changepoint cp_0042. Based on 1,000 Monte Carlo simulation paths, 88% cross the 27.0 °C threshold within 11 minutes (median crossing 360 s).',
              status_hint: 'WARN',
              evidence: ['fc_0193', 'cp_0042'],
              meta: {
                quality: 'ai_generated',
                model: 'gemini-1.5-pro',
                as_of: new Date().toISOString(),
              },
            })
          );
          return;
        }

        // POST /api/ai/propose
        if (pathname === '/api/ai/propose' && req.method === 'POST') {
          res.statusCode = 201;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              proposal_id: 'pr_0007',
              created_at: new Date().toISOString(),
              scope: { rack_id: 'rack-01', node_id: 'r1-n2', tenant_id: 't-beta' },
              action: 'REDUCE_TENANT_LOAD',
              target: 't-beta',
              rationale: 'Beta Compute workload on node r1-n2 correlates with 71% of thermal slope increase. Throttling computational job to 50% restores margin without requiring cold-aisle rebalancing.',
              expected_effect: 'Cooling margin recovers to +3.8 °C above threshold within 240 s',
              evidence: ['fc_0193', 'cp_0042'],
              risk_tier: 'MEDIUM',
              status: 'PROPOSED',
              meta: {
                quality: 'ai_generated',
                model: 'gemini-1.5-pro',
                as_of: new Date().toISOString(),
              },
            })
          );
          return;
        }

        // POST /api/ai/chat
        if (pathname === '/api/ai/chat' && req.method === 'POST') {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });
          req.on('end', () => {
            const { message } = JSON.parse(body || '{}');
            const isMigrate = /migrate/i.test(message || '');
            const isApproveAttempt = /approve|authorize/i.test(message || '');

            let reply = 'Evaluating operational implications against thermal baseline.';
            let revision = null;

            if (isApproveAttempt) {
              reply = 'As an AI advisory system, I cannot authorize changes or arm the reader. Authorization strictly requires dashboard operator approval and physical RFID tap confirmation.';
            } else if (isMigrate) {
              reply = 'Migration alternative evaluated: Migrating Beta Compute to Rack 02 bay U22 achieves immediate thermal relief in Rack 01 (+4.2 °C margin) with a 45 s VM migration pause window.';
              revision = {
                proposal_id: 'pr_0007',
                created_at: new Date().toISOString(),
                scope: { rack_id: 'rack-01', node_id: 'r1-n2', tenant_id: 't-beta' },
                action: 'MIGRATE_TENANT',
                target: 't-beta',
                rationale: 'Migrate active containers to reserve bay rack-02-u22 to eliminate thermal hotspot while sustaining full tenant compute allocation.',
                expected_effect: 'Inlet temperature stabilizes at 23.8 °C; eliminates rack-01 thermal breach',
                evidence: ['fc_0193', 'cp_0042'],
                risk_tier: 'MEDIUM',
                status: 'DISCUSSING',
                meta: { quality: 'ai_generated', model: 'gemini-1.5-pro', as_of: new Date().toISOString() },
              };
            } else {
              reply = 'The proposed load reduction achieves thermal recovery in 4 minutes with zero migration downtime risk. Proceed to arm the physical console when ready.';
            }

            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                reply,
                proposal_revision: revision,
                meta: { quality: 'ai_generated', as_of: new Date().toISOString() },
              })
            );
          });
          return;
        }

        // GET /api/proposals
        if (pathname === '/api/proposals' && req.method === 'GET') {
          const allProposals = [
            {
              proposal_id: 'pr_0007',
              created_at: new Date(Date.now() - 300000).toISOString(),
              scope: { rack_id: 'rack-01', node_id: 'r1-n2', tenant_id: 't-beta' },
              action: 'REDUCE_TENANT_LOAD',
              target: 't-beta',
              rationale: 'Beta Compute workload on node r1-n2 correlates with 71% of thermal slope increase. Throttling computational job to 50% restores margin without requiring cold-aisle rebalancing.',
              expected_effect: 'Cooling margin recovers to +3.8 °C above threshold within 240 s',
              evidence: ['fc_0193', 'cp_0042'],
              risk_tier: 'MEDIUM',
              status: 'PROPOSED',
              meta: { quality: 'ai_generated', model: 'gemini-1.5-pro', as_of: new Date().toISOString() },
            },
            {
              proposal_id: 'pr_0008',
              created_at: new Date(Date.now() - 600000).toISOString(),
              scope: { rack_id: 'rack-02', node_id: 'r2-n1', tenant_id: 't-alpha' },
              action: 'INSPECT_FAN',
              target: 'r2-fan-01',
              rationale: 'Vibration harmonic anomaly detected at 2.4x baseline. Inspect chassis fan assembly for bearing wear.',
              expected_effect: 'Prevents mechanical imbalance escalation',
              evidence: ['cp_0042'],
              risk_tier: 'LOW',
              status: 'DISCUSSING',
              meta: { quality: 'ai_generated', model: 'gemini-1.5-pro', as_of: new Date().toISOString() },
            },
          ];

          // Scoping: tenant only sees proposals for their tenant_id
          const scopedProposals = isTenant
            ? allProposals.filter((p) => p.scope.tenant_id === 't-beta')
            : allProposals;

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ proposals: scopedProposals }));
          return;
        }

        // POST /api/proposals/:id/approve
        const approveMatch = pathname.match(/^\/api\/proposals\/([^/]+)\/approve$/);
        if (approveMatch && req.method === 'POST') {
          const proposalId = approveMatch[1];
          // Non-negotiable: Tenant attempting POST /approve gets 404 NOT_FOUND
          if (isTenant) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: { code: 'NOT_FOUND', message: 'Resource not found' },
              })
            );
            return;
          }

          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              proposal_id: proposalId,
              status: 'APPROVED_PENDING_TAP',
              nonce: 'nonce-pr07-8849',
              expires_at: new Date(Date.now() + 60000).toISOString(),
              reader_device_id: 'reader-01',
            })
          );
          return;
        }

        // POST /api/proposals/:id/reject
        const rejectMatch = pathname.match(/^\/api\/proposals\/([^/]+)\/reject$/);
        if (rejectMatch && req.method === 'POST') {
          const proposalId = rejectMatch[1];
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ proposal_id: proposalId, status: 'REJECTED' }));
          return;
        }

        // GET /api/audit
        if (pathname === '/api/audit' && req.method === 'GET') {
          const allAuditRows = [
            {
              seq: 1842,
              ts: new Date(Date.now() - 10000).toISOString(),
              actor: 'ai:advisory-agent',
              event: 'AI_PROPOSAL',
              subject: { node_id: 'r1-n2', proposal_id: 'pr_0007', tenant_id: 't-beta' },
              payload: { action: 'REDUCE_TENANT_LOAD', target: 't-beta', risk_tier: 'MEDIUM' },
              prev_hash: '5b2c8a1f9e0d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b',
              hash: '9f2c4a1b8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1',
            },
            {
              seq: 1841,
              ts: new Date(Date.now() - 60000).toISOString(),
              actor: 'system',
              event: 'CHANGE_POINT',
              subject: { node_id: 'r1-n1', tenant_id: 't-alpha' },
              payload: { cp_id: 'cp_0042', delta: 1.5, detector: 'cusum+pelt' },
              prev_hash: '3a1f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f',
              hash: '5b2c8a1f9e0d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b',
            },
            {
              seq: 1840,
              ts: new Date(Date.now() - 120000).toISOString(),
              actor: 'user:superuser-user',
              event: 'PROPOSAL_APPROVED',
              subject: { proposal_id: 'pr_0006', tenant_id: 't-beta' },
              payload: { nonce: 'nonce-pr06-9812', expires_in_s: 60, reader: 'reader-01' },
              prev_hash: '1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e',
              hash: '3a1f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f',
            },
            {
              seq: 1839,
              ts: new Date(Date.now() - 180000).toISOString(),
              actor: 'reader:reader-01',
              event: 'TAP_AUTHORIZED',
              subject: { proposal_id: 'pr_0006', tenant_id: 't-beta' },
              payload: { uid: '04A2B3C4D5', actor: 'Mounesh E Belavadi' },
              prev_hash: '0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d',
              hash: '1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e',
            },
          ];

          const scopedAuditRows = isTenant
            ? allAuditRows.filter((r) => r.subject.tenant_id === 't-beta')
            : allAuditRows;

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ rows: scopedAuditRows }));
          return;
        }

        // GET /api/audit/verify
        if (pathname === '/api/audit/verify' && req.method === 'GET') {
          const isTampered = urlObj.searchParams.get('tamper') === 'true';
          res.setHeader('Content-Type', 'application/json');
          if (isTampered) {
            res.end(
              JSON.stringify({
                ok: false,
                rows_checked: 1842,
                head_hash: '9f2c4a1b8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1',
                broken_at: 903,
              })
            );
          } else {
            res.end(
              JSON.stringify({
                ok: true,
                rows_checked: 1842,
                head_hash: '9f2c4a1b8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1',
                broken_at: null,
              })
            );
          }
          return;
        }

        // GET /api/reader/:device_id/pending
        const readerPendingMatch = pathname.match(/^\/api\/reader\/([^/]+)\/pending$/);
        if (readerPendingMatch && req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              armed: true,
              proposal_id: 'pr_0007',
              nonce: 'nonce-pr07-8849',
              expires_at: new Date(Date.now() + 47000).toISOString(),
              expires_in_s: 47,
              action: 'REDUCE_TENANT_LOAD',
              target: 't-beta',
              line1: 'REDUCE LOAD',
              line2: 'Tenant: Beta Compute',
              risk_tier: 'MEDIUM',
            })
          );
          return;
        }

        // POST /api/reader/:device_id/tap
        const readerTapMatch = pathname.match(/^\/api\/reader\/([^/]+)\/tap$/);
        if (readerTapMatch && req.method === 'POST') {
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              result: 'AUTHORIZED',
              proposal_id: 'pr_0007',
              actor: 'Mounesh E Belavadi',
              audit_hash: '9f2c4a1b8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1',
              message: 'Authorized',
            })
          );
          return;
        }

        next();
      });

      if (server.httpServer) {
        const wss = new WebSocketServer({ noServer: true });

        server.httpServer.on('upgrade', (req, socket, head) => {
          const url = new URL(req.url || '', 'http://localhost:5173');
          if (url.pathname === '/ws') {
            wss.handleUpgrade(req, socket, head, (ws) => {
              wss.emit('connection', ws, req);
            });
          }
        });

        wss.on('connection', (ws: WebSocket, req) => {
          const url = new URL(req.url || '', 'http://localhost:5173');
          const token = url.searchParams.get('token') || '';
          const isTenant = token.includes('tenant');

          let subscribedRacks: string[] = ['rack-01'];

          ws.on('message', (message: string) => {
            try {
              const frame = JSON.parse(message.toString());
              if (frame.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', ts: new Date().toISOString() }));
              } else if (frame.type === 'subscribe') {
                if (frame.data && Array.isArray(frame.data.racks)) {
                  subscribedRacks = frame.data.racks;
                }
              }
            } catch {
              // ignore malformed
            }
          });

          // Telemetry streaming interval (1500 ms)
          const interval = setInterval(() => {
            if (ws.readyState !== WebSocket.OPEN) return;

            const now = new Date().toISOString();
            const rackNodes: Record<string, Array<{ node_id: string; tenant_id: string }>> = {
              'rack-01': [
                { node_id: 'r1-n1', tenant_id: 't-alpha' },
                { node_id: 'r1-n2', tenant_id: 't-beta' },
              ],
              'rack-02': [
                { node_id: 'r2-n1', tenant_id: 't-beta' },
                { node_id: 'r2-n2', tenant_id: 't-alpha' },
                { node_id: 'r2-n3', tenant_id: 't-beta' },
              ],
            };

            subscribedRacks.forEach((rackId) => {
              const nodes = rackNodes[rackId] || [];
              nodes.forEach((n) => {
                // Scope enforcement: A tenant socket NEVER receives a frame for foreign nodes
                if (isTenant && n.tenant_id !== 't-beta') {
                  return;
                }

                // Send telemetry frame
                const val = n.node_id === 'r1-n2' ? 24.61 : 23.8;
                ws.send(
                  JSON.stringify({
                    type: 'telemetry',
                    ts: now,
                    data: {
                      node_id: n.node_id,
                      metric: 't_c',
                      value: val,
                      unit: '°C',
                      meta: {
                        quality: 'measured',
                        source: `node:${n.node_id}:dht22`,
                        as_of: now,
                      },
                    },
                  })
                );

                // Send power estimate frame (always estimated)
                ws.send(
                  JSON.stringify({
                    type: 'power_estimate',
                    ts: now,
                    data: {
                      node_id: n.node_id,
                      value: 1.08,
                      unit: 'W',
                      meta: {
                        quality: 'estimated',
                        model: 'linear-cpu-v1',
                        uncertainty_pct: 30,
                        as_of: now,
                      },
                    },
                  })
                );
              });
            });
          }, 1500);

          ws.on('close', () => {
            clearInterval(interval);
          });
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), devApiPlugin()],
  server: {
    port: 5173,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
