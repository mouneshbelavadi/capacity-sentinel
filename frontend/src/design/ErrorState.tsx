import React from 'react';
import {
  AlertOctagon,
  Clock,
  KeyRound,
  ShieldAlert,
  ServerCrash,
  RefreshCw,
  Cpu,
  ThermometerSnowflake,
  Lock,
} from 'lucide-react';
import { ErrorCode } from '../api/contract';

export interface ErrorStateProps {
  code: ErrorCode;
  message?: string;
  detail?: Record<string, unknown>;
  onRetry?: () => void;
  className?: string;
}

interface ErrorDescription {
  title: string;
  defaultMessage: string;
  guidance: string;
  Icon: React.ElementType;
}

const ERROR_DESCRIPTIONS: Record<ErrorCode, ErrorDescription> = {
  UNAUTHENTICATED: {
    title: 'Authentication Required',
    defaultMessage: 'Your session has expired or no bearer token was provided.',
    guidance: 'Log in again with your credentials to obtain an active session token.',
    Icon: Lock,
  },
  FORBIDDEN: {
    title: 'Permission Denied',
    defaultMessage: 'Your assigned role does not have authorization for this operation.',
    guidance: 'Verify your access permissions or request assistance from a Super User.',
    Icon: ShieldAlert,
  },
  NOT_FOUND: {
    title: 'Resource Not Found',
    defaultMessage: 'The requested node, slot, rack, or proposal was not found.',
    guidance: 'Confirm the identifier is correct and owned within your tenant scope.',
    Icon: AlertOctagon,
  },
  VALIDATION_ERROR: {
    title: 'Invalid Request Payload',
    defaultMessage: 'The server rejected the submitted parameters as malformed.',
    guidance: 'Review the input fields and adhere strictly to the API contract requirements.',
    Icon: AlertOctagon,
  },
  CONTRACT_VERSION_MISMATCH: {
    title: 'Contract Version Drift',
    defaultMessage: 'A major schema version difference was detected between client and backend.',
    guidance: 'Deploy the updated frontend matching the backend contract version.',
    Icon: ServerCrash,
  },
  NONCE_EXPIRED: {
    title: 'Approval Nonce Expired',
    defaultMessage: 'The 60-second authorization window elapsed before a tap was registered.',
    guidance: 'Click Proceed again to generate a new 60-second single-use authorization window.',
    Icon: Clock,
  },
  NONCE_CONSUMED: {
    title: 'Nonce Already Used',
    defaultMessage: 'This authorization nonce was already consumed by an earlier tap.',
    guidance: 'A fresh proposal approval is required for subsequent actions.',
    Icon: KeyRound,
  },
  UID_NOT_AUTHORIZED: {
    title: 'Card Not Authorized',
    defaultMessage: 'The scanned RFID card UID is not registered or lacks permissions for this risk tier.',
    guidance: 'Ensure your card UID is provisioned in Access Control with adequate role rights.',
    Icon: ShieldAlert,
  },
  DEVICE_UNKNOWN: {
    title: 'Unrecognized Reader Device',
    defaultMessage: 'The requesting RFID console device ID is not recognized by the backend.',
    guidance: 'Register the hardware device in the reader registry before authorizing actions.',
    Icon: Cpu,
  },
  HMAC_INVALID: {
    title: 'Invalid Device Signature',
    defaultMessage: 'The HMAC signature over device_id, uid, nonce, and timestamp failed verification.',
    guidance: 'Check that the pre-shared secret in secrets.h matches the server device record.',
    Icon: ShieldAlert,
  },
  CLOCK_SKEW: {
    title: 'Hardware Clock Skew',
    defaultMessage: 'The reader timestamp deviates by more than 120 seconds from the server clock.',
    guidance: 'Allow the reader to resync NTP with the time server and retry.',
    Icon: Clock,
  },
  AI_EVIDENCE_INVALID: {
    title: 'Unverified AI Evidence',
    defaultMessage: 'The LLM cited an evidence identifier that was not supplied in the prompt.',
    guidance: 'The proposal was discarded to maintain audit integrity. Re-run proposal generation.',
    Icon: AlertOctagon,
  },
  AI_ACTION_NOT_WHITELISTED: {
    title: 'Unauthorized Action Proposed',
    defaultMessage: 'The LLM recommended an action outside the approved whitelist.',
    guidance: 'The proposal was blocked and audited. Only closed-whitelist actions are permitted.',
    Icon: ShieldAlert,
  },
  AI_UNAVAILABLE: {
    title: 'Advisory Engine Offline',
    defaultMessage: 'The cloud LLM advisory service is unreachable or rate limited.',
    guidance: 'Deterministic capacity models and telemetry remain operational. Retry shortly.',
    Icon: ServerCrash,
  },
  FORECAST_INSUFFICIENT_DATA: {
    title: 'Insufficient Data for Forecast',
    defaultMessage: 'Not enough historical samples exist following the most recent change point.',
    guidance: 'Allow the node to accumulate samples before fitting an exponential smoothing model.',
    Icon: Clock,
  },
  SENSOR_WARMING_UP: {
    title: 'Sensor Warming Up',
    defaultMessage: 'The sensor (MQ135 air quality) has not completed its required preheat duration.',
    guidance: 'Readings will automatically become available once the preheat interval elapses.',
    Icon: ThermometerSnowflake,
  },
  RATE_LIMITED: {
    title: 'Rate Limit Exceeded',
    defaultMessage: 'Too many requests were submitted in a short interval.',
    guidance: 'Pause briefly and space out subsequent actions.',
    Icon: Clock,
  },
  INTERNAL: {
    title: 'Internal Server Error',
    defaultMessage: 'An unexpected internal processing error occurred.',
    guidance: 'Review server logs for details. System telemetry storage remains active.',
    Icon: ServerCrash,
  },
};

export const ErrorState: React.FC<ErrorStateProps> = ({
  code,
  message,
  detail,
  onRetry,
  className = '',
}) => {
  const errorInfo = ERROR_DESCRIPTIONS[code] || ERROR_DESCRIPTIONS.INTERNAL;
  const { title, defaultMessage, guidance, Icon } = errorInfo;
  const displayMessage = message || defaultMessage;

  return (
    <div
      className={`p-4 bg-surface border border-crit/30 rounded-lg shadow-card text-ink ${className}`}
      role="alert"
    >
      <div className="flex items-start gap-3">
        <div className="p-1.5 rounded bg-crit-weak text-crit">
          <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-14 font-semibold text-ink">{title}</h4>
            <span className="font-mono text-11 uppercase px-1.5 py-0.5 rounded bg-surface-sunken border border-border text-ink-2">
              {code}
            </span>
          </div>

          <p className="text-13 text-ink mt-1">{displayMessage}</p>

          <p className="text-12 text-ink-2 mt-1 italic">{guidance}</p>

          {detail && Object.keys(detail).length > 0 && (
            <div className="mt-2 p-2 bg-surface-sunken border border-border rounded text-11 font-mono text-ink-2 overflow-x-auto">
              <pre>{JSON.stringify(detail, null, 2)}</pre>
            </div>
          )}

          {onRetry && (
            <div className="mt-3">
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-surface hover:bg-surface-hover text-12 font-medium text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <RefreshCw size={14} strokeWidth={1.5} />
                <span>Retry Action</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
