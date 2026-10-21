import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { api, ApiError } from './api';

export interface Grant {
  id: string;
  role: string;
  roleLabel: string;
  officialDesignation: string | null;
  scope: string;
  institutionId: string | null;
}

export interface Me {
  user: { id: string; name: string; email: string };
  activeGrant: Grant;
  grants: Grant[];
  capabilities: string[];
  roleLabel: string;
}

interface SessionValue {
  me: Me;
  can: (cap: string) => boolean;
  switchRole: (grantId: string) => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Me>('/me'),
    retry: (count, err) => !(err instanceof ApiError && err.status === 401) && count < 2,
  });
}

export function SessionProvider({ me, children }: { me: Me; children: ReactNode }) {
  const qc = useQueryClient();
  const value: SessionValue = {
    me,
    can: (cap) => me.capabilities.includes(cap),
    switchRole: async (grantId) => {
      await api.post('/auth/switch-role', { grantId });
      qc.clear();
      window.location.assign('/');
    },
    logout: async () => {
      await api.post('/auth/logout');
      qc.clear();
      window.location.assign('/login');
    },
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

export interface Meta {
  brandName: string;
  demoMode: boolean;
  businessTime: string;
  demoClockOffsetMs: number;
  demoAccounts: Array<{ email: string; label: string }>;
}

export function useMeta() {
  return useQuery({ queryKey: ['meta'], queryFn: () => api.get<Meta>('/meta'), staleTime: 30_000 });
}
