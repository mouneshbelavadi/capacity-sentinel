import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { Value } from '../design/Value';
import { StatusBadge } from '../design/StatusBadge';
import { ErrorState } from '../design/ErrorState';
import { ErrorCode } from '../api/contract';

describe('Design Primitives — Value Provenance', () => {
  it('renders measured values plainly with no badge', () => {
    const { container } = render(
      <Value
        value={24.61}
        unit="°C"
        meta={{
          quality: 'measured',
          source: 'node:r1-n1:dht22',
          as_of: '2026-10-28T10:04:02Z',
        }}
      />
    );
    expect(screen.getByText('24.61')).toBeInTheDocument();
    expect(screen.getByText('°C')).toBeInTheDocument();
    // Measured has NO badge/chip
    expect(container.querySelector('.uppercase')).toBeNull();
  });

  it('renders estimated values with EST. chip', () => {
    render(
      <Value
        value={1.08}
        unit="W"
        meta={{
          quality: 'estimated',
          model: 'linear-cpu-v1',
          uncertainty_pct: 30,
          as_of: '2026-10-28T10:04:02Z',
        }}
      />
    );
    expect(screen.getByText('1.08')).toBeInTheDocument();
    expect(screen.getByText('W')).toBeInTheDocument();
    expect(screen.getByText('EST.')).toBeInTheDocument();
  });

  it('renders inferred values with INFERRED chip', () => {
    render(
      <Value
        value={71}
        unit="%"
        meta={{
          quality: 'inferred',
          basis: 'slope increased 3.1x within 40s of tenant node coming online',
          as_of: '2026-10-28T10:04:02Z',
        }}
      />
    );
    expect(screen.getByText('71')).toBeInTheDocument();
    expect(screen.getByText('INFERRED')).toBeInTheDocument();
  });

  it('renders ai_generated values with AI · ADVISORY chip', () => {
    render(
      <Value
        value="REDUCE_LOAD"
        meta={{
          quality: 'ai_generated',
          as_of: '2026-10-28T10:04:02Z',
        }}
      />
    );
    expect(screen.getByText('REDUCE_LOAD')).toBeInTheDocument();
    expect(screen.getByText('AI · ADVISORY')).toBeInTheDocument();
  });
});

describe('Design Primitives — StatusBadge', () => {
  it('renders icon + colour + word for OK, WARN, CRIT, OFFLINE, UNKNOWN', () => {
    const { rerender } = render(<StatusBadge status="OK" />);
    expect(screen.getByText('OK')).toBeInTheDocument();

    rerender(<StatusBadge status="WARN" />);
    expect(screen.getByText('WARN')).toBeInTheDocument();

    rerender(<StatusBadge status="CRIT" />);
    expect(screen.getByText('CRIT')).toBeInTheDocument();

    rerender(<StatusBadge status="OFFLINE" />);
    expect(screen.getByText('OFFLINE')).toBeInTheDocument();

    rerender(<StatusBadge status="UNKNOWN" />);
    expect(screen.getByText('UNKNOWN')).toBeInTheDocument();
  });
});

describe('Design Primitives — ErrorState closed code branches', () => {
  const allCodes: ErrorCode[] = [
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'NOT_FOUND',
    'VALIDATION_ERROR',
    'CONTRACT_VERSION_MISMATCH',
    'NONCE_EXPIRED',
    'NONCE_CONSUMED',
    'UID_NOT_AUTHORIZED',
    'DEVICE_UNKNOWN',
    'HMAC_INVALID',
    'CLOCK_SKEW',
    'AI_EVIDENCE_INVALID',
    'AI_ACTION_NOT_WHITELISTED',
    'AI_UNAVAILABLE',
    'FORECAST_INSUFFICIENT_DATA',
    'SENSOR_WARMING_UP',
    'RATE_LIMITED',
    'INTERNAL',
  ];

  allCodes.forEach((code) => {
    it(`renders specific message branch for code ${code}`, () => {
      render(<ErrorState code={code} />);
      expect(screen.getByText(code)).toBeInTheDocument();
    });
  });
});
