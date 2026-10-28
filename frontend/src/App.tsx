import React, { useEffect, useState, useCallback } from 'react';
import { useAuthStore } from './app/authStore';
import { apiClient, onContractVersionMismatch } from './api/client';
import { CONTRACT_VERSION } from './api/contract';
import { LoginPage } from './features/auth/LoginPage';
import { Shell, NavSection } from './app/Shell';
import { DataCenterDashboard } from './features/datacenter/DataCenterDashboard';
import { TenantDashboard } from './features/tenant/TenantDashboard';
import { AccessControl } from './features/access/AccessControl';
import { ForecastView } from './features/forecast/ForecastView';
import { ApprovalsView } from './features/proposals/ApprovalsView';
import { AuditView } from './features/audit/AuditView';
import { ContractMismatchBanner } from './design/ContractMismatchBanner';

export const App: React.FC = () => {
  const { user, token, checkAuth } = useAuthStore();
  const [currentPath, setCurrentPath] = useState<string>(
    typeof window !== 'undefined' ? window.location.pathname : '/datacenter'
  );
  const [versionMismatch, setVersionMismatch] = useState<{
    clientVersion: string;
    backendVersion: string;
  } | null>(null);

  // Synchronize path changes with window.history
  const navigateTo = useCallback((path: string) => {
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', path);
    }
    setCurrentPath(path);
  }, []);

  // Listen to popstate (browser back/forward)
  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Boot check: contract version listener & auth initialization
  useEffect(() => {
    const unsubscribe = onContractVersionMismatch((mismatch) => {
      setVersionMismatch(mismatch);
    });

    // Check URL parameters for explicit mismatch testing (Acceptance #7)
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('test_mismatch') === 'true') {
        setVersionMismatch({
          clientVersion: CONTRACT_VERSION,
          backendVersion: '2.0.0', // Major bump simulation
        });
      } else {
        apiClient.verifyContractVersion().catch(() => {});
      }
    }

    checkAuth().catch(() => {});

    return () => {
      unsubscribe();
    };
  }, [checkAuth]);

  // Role-based routing enforcement and redirection
  useEffect(() => {
    if (!token || !user) return;

    if (user.role === 'TENANT') {
      // Convenience redirect only, NOT a security control.
      // Tenant isolation is strictly enforced server-side via apply_scope();
      // foreign resources return 404 regardless of frontend navigation.
      if (currentPath.startsWith('/datacenter')) {
        navigateTo(currentPath.includes('/racks') ? '/tenant/racks' : '/tenant');
      } else if (currentPath === '/' || currentPath === '/login') {
        navigateTo('/tenant');
      }
    } else if (user.role === 'OPERATOR') {
      if (currentPath.startsWith('/tenant') || currentPath === '/datacenter/access') {
        navigateTo(currentPath.includes('/racks') ? '/datacenter/racks' : '/datacenter');
      } else if (currentPath === '/' || currentPath === '/login') {
        navigateTo('/datacenter');
      }
    } else if (user.role === 'SUPER_USER') {
      if (currentPath === '/' || currentPath === '/login') {
        navigateTo('/datacenter');
      }
    }
  }, [token, user, currentPath, navigateTo]);

  // If major contract version mismatch detected, block with full-screen banner
  if (versionMismatch) {
    return (
      <ContractMismatchBanner
        clientVersion={versionMismatch.clientVersion}
        backendVersion={versionMismatch.backendVersion}
        onDismiss={() => setVersionMismatch(null)}
      />
    );
  }

  // If unauthenticated, render login page
  if (!token || !user) {
    return <LoginPage />;
  }

  // Derive active navigation section from current path
  let activeSection: NavSection = 'overview';
  if (currentPath === '/datacenter/access') {
    activeSection = 'access';
  } else if (currentPath.includes('/racks')) {
    activeSection = 'racks';
  } else if (currentPath.includes('/forecasts')) {
    activeSection = 'forecasts';
  } else if (currentPath.includes('/approvals')) {
    activeSection = 'approvals';
  } else if (currentPath.includes('/audit')) {
    activeSection = 'audit';
  }

  const handleNavSelect = (section: NavSection) => {
    if (section === 'access') {
      navigateTo('/datacenter/access');
    } else if (section === 'racks') {
      navigateTo(user.role === 'TENANT' ? '/tenant/racks' : '/datacenter/racks');
    } else if (section === 'forecasts') {
      navigateTo(user.role === 'TENANT' ? '/tenant/forecasts' : '/datacenter/forecasts');
    } else if (section === 'approvals') {
      navigateTo(user.role === 'TENANT' ? '/tenant/approvals' : '/datacenter/approvals');
    } else if (section === 'audit') {
      navigateTo(user.role === 'TENANT' ? '/tenant/audit' : '/datacenter/audit');
    } else if (user.role === 'TENANT') {
      navigateTo('/tenant');
    } else {
      navigateTo('/datacenter');
    }
  };

  // Render view corresponding to route and role
  if (currentPath.includes('/racks')) {
    const isTenant = user.role === 'TENANT' || currentPath.startsWith('/tenant');
    return (
      <Shell
        currentSection="racks"
        onNavigate={handleNavSelect}
        pageTitle={isTenant ? "Assigned Racks" : "Data Center Racks"}
        breadcrumb={['Site 01', 'Racks']}
      >
        {isTenant ? <TenantDashboard onlyRacks /> : <DataCenterDashboard onlyRacks />}
      </Shell>
    );
  }

  if (currentPath === '/datacenter/access' && user.role === 'SUPER_USER') {
    return (
      <Shell
        currentSection="access"
        onNavigate={handleNavSelect}
        pageTitle="Access Control"
        breadcrumb={['Data Center', 'Access Control']}
      >
        <AccessControl />
      </Shell>
    );
  }

  if (currentPath.includes('/forecasts')) {
    return (
      <Shell
        currentSection="forecasts"
        onNavigate={handleNavSelect}
        pageTitle="Exhaustion Forecasts & Capacity"
        breadcrumb={['Site 01', user.role === 'TENANT' ? 'Tenant Forecasts' : 'Facility Forecasts']}
      >
        <ForecastView />
      </Shell>
    );
  }

  if (currentPath.includes('/approvals')) {
    return (
      <Shell
        currentSection="approvals"
        onNavigate={handleNavSelect}
        pageTitle={user.role === 'TENANT' ? 'Tenant Action Proposals' : 'Facility Approvals Queue'}
        breadcrumb={['Site 01', user.role === 'TENANT' ? 'Tenant Approvals' : 'Approvals Queue']}
      >
        <ApprovalsView />
      </Shell>
    );
  }

  if (currentPath.includes('/audit')) {
    return (
      <Shell
        currentSection="audit"
        onNavigate={handleNavSelect}
        pageTitle={user.role === 'TENANT' ? 'Tenant Audit Log' : 'Facility Immutable Audit Chain'}
        breadcrumb={['Site 01', user.role === 'TENANT' ? 'Tenant Audit' : 'Audit Chain']}
      >
        <AuditView />
      </Shell>
    );
  }

  if (user.role === 'TENANT' || currentPath === '/tenant') {
    return (
      <Shell
        currentSection={activeSection}
        onNavigate={handleNavSelect}
        pageTitle="Tenant Dashboard"
        breadcrumb={['Site 01', user.tenant_id || 'Tenant Scope']}
      >
        <TenantDashboard />
      </Shell>
    );
  }

  // Default for OPERATOR and SUPER_USER
  return (
    <Shell
      currentSection={activeSection}
      onNavigate={handleNavSelect}
      pageTitle="Data Center Dashboard"
      breadcrumb={['Site 01', 'Facility Overview']}
    >
      <DataCenterDashboard />
    </Shell>
  );
};

export default App;
