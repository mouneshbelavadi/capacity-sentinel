import { create } from 'zustand';
import { Role, AuthMeResponse, LoginResponse } from '../api/contract';
import { apiClient, getStoredToken, setStoredToken } from '../api/client';

export interface AuthState {
  user: AuthMeResponse | null;
  token: string | null;
  isLoading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  checkAuth: () => Promise<void>;
  setUserManually: (user: AuthMeResponse, token: string) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: getStoredToken(),
  isLoading: false,
  error: null,

  login: async (username: string, password: string): Promise<boolean> => {
    set({ isLoading: true, error: null });
    try {
      const response = await apiClient.post<LoginResponse>('/api/auth/login', {
        username,
        password,
      });

      setStoredToken(response.access_token);
      set({
        user: {
          user_id: response.role.toLowerCase() + '-' + (response.tenant_id || 'site'),
          role: response.role,
          tenant_id: response.tenant_id,
          display_name: response.display_name,
        },
        token: response.access_token,
        isLoading: false,
        error: null,
      });
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      set({ isLoading: false, error: msg });
      return false;
    }
  },

  logout: () => {
    setStoredToken(null);
    set({ user: null, token: null, error: null });
  },

  checkAuth: async () => {
    const token = getStoredToken();
    if (!token) {
      set({ user: null, token: null, isLoading: false });
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const me = await apiClient.get<AuthMeResponse>('/api/auth/me');
      set({ user: me, token, isLoading: false });
    } catch {
      // Token invalid or expired
      setStoredToken(null);
      set({ user: null, token: null, isLoading: false });
    }
  },

  setUserManually: (user: AuthMeResponse, token: string) => {
    setStoredToken(token);
    set({ user, token, isLoading: false, error: null });
  },
}));

/**
 * Human readable role label mapping per shared/design-system.md §4:
 * "Tenant" / "Operator" / "Super User"
 * Notice: Elevated role is strictly SUPER_USER.
 */
export function formatRoleLabel(role: Role): string {
  switch (role) {
    case 'TENANT':
      return 'Tenant';
    case 'OPERATOR':
      return 'Operator';
    case 'SUPER_USER':
      return 'Super User';
    default:
      return role;
  }
}
