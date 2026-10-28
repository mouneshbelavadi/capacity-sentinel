import React from 'react';
import { Card } from '../../design/Card';
import { DataTable, Column } from '../../design/DataTable';
import { Chip } from '../../design/Chip';
import { EmptyState } from '../../design/EmptyState';
import { ShieldCheck, KeyRound } from 'lucide-react';

interface ProvisionedTenant {
  tenant_id: string;
  label: string;
  slot_count: number;
  contact: string;
}

interface AuthorizedRfidCard {
  uid: string;
  user_name: string;
  role: string;
  risk_tier_limit: 'LOW' | 'MEDIUM' | 'HIGH';
  status: 'ACTIVE' | 'REVOKED';
}

export const AccessControl: React.FC = () => {
  const tenantColumns: Column<ProvisionedTenant>[] = [
    {
      key: 'tenant_id',
      header: 'Tenant ID',
      render: (item) => <span className="font-mono text-12 font-medium text-ink">{item.tenant_id}</span>,
    },
    {
      key: 'label',
      header: 'Organization',
      render: (item) => <span className="font-medium text-ink">{item.label}</span>,
    },
    {
      key: 'slot_count',
      header: 'Allocated Slots',
      align: 'right',
      render: (item) => <span className="font-mono text-ink-2">{item.slot_count}</span>,
    },
    {
      key: 'contact',
      header: 'Technical Contact',
      render: (item) => <span className="text-ink-2">{item.contact}</span>,
    },
  ];

  const cardColumns: Column<AuthorizedRfidCard>[] = [
    {
      key: 'uid',
      header: 'RFID Card UID (Public)',
      render: (item) => (
        <span className="font-mono text-12 font-semibold text-ink tracking-wider">
          {item.uid}
        </span>
      ),
    },
    {
      key: 'user',
      header: 'Designated Operator',
      render: (item) => <span className="font-medium text-ink">{item.user_name}</span>,
    },
    {
      key: 'role',
      header: 'Role Clearance',
      render: (item) => <span className="text-ink-2">{item.role}</span>,
    },
    {
      key: 'risk_tier',
      header: 'Risk Authorization',
      render: (item) => <Chip variant="neutral">{item.risk_tier_limit}</Chip>,
    },
    {
      key: 'status',
      header: 'Card Status',
      align: 'center',
      render: (item) => (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-11 font-medium ${
            item.status === 'ACTIVE'
              ? 'bg-ok-weak text-ok'
              : 'bg-crit-weak text-crit'
          }`}
        >
          {item.status}
        </span>
      ),
    },
  ];

  const sampleTenants: ProvisionedTenant[] = [
    {
      tenant_id: 't-alpha',
      label: 'Alpha Systems',
      slot_count: 2,
      contact: 'noc@alpha-systems.example',
    },
    {
      tenant_id: 't-beta',
      label: 'Beta Compute',
      slot_count: 2,
      contact: 'ops@betacompute.example',
    },
  ];

  const sampleCards: AuthorizedRfidCard[] = [
    {
      uid: '04A2B3C4D5',
      user_name: 'Mounesh E Belavadi',
      role: 'Super User',
      risk_tier_limit: 'HIGH',
      status: 'ACTIVE',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Security Model Advisory */}
      <div className="p-4 bg-surface border border-border rounded-lg shadow-card text-12 space-y-1">
        <div className="flex items-center gap-2 font-semibold text-ink">
          <ShieldCheck size={16} strokeWidth={1.5} className="text-primary" />
          <span>Two-Factor Physical RFID Approval Protocol</span>
        </div>
        <p className="text-ink-2 leading-relaxed">
          An RFID card UID is an identifier, not a secret. The tap functions as the physical
          second factor for proposals armed by an operator on the console, validated with a
          single-use 60-second nonce and an HMAC over <code className="font-mono text-11">device_id|uid|nonce|ts</code>.
        </p>
      </div>

      {/* Provisioned Tenants */}
      <Card
        title="Provisioned Tenants"
        subtitle="Active tenant boundaries for Site-01"
      >
        <DataTable
          columns={tenantColumns}
          data={sampleTenants}
          keyExtractor={(item) => item.tenant_id}
          emptyState={
            <EmptyState
              icon={ShieldCheck}
              title="No Tenants Configured"
              description="No tenant boundaries have been provisioned in the database."
            />
          }
        />
      </Card>

      {/* RFID Card Allowlist */}
      <Card
        title="Physical RFID Allowlist"
        subtitle="Registered cards for physical proposal authorization"
      >
        <DataTable
          columns={cardColumns}
          data={sampleCards}
          keyExtractor={(item) => item.uid}
          emptyState={
            <EmptyState
              icon={KeyRound}
              title="No RFID Cards Registered"
              description="No physical RFID cards are currently enrolled in the reader allowlist."
            />
          }
        />
      </Card>
    </div>
  );
};
