import useSWR from 'swr';
import { fetcher } from '../lib/api';

export type Role = 'admin' | 'superadmin' | 'editor' | 'viewer';

export interface User {
  id: string;
  username: string;
  email: string;
  role: Role;
  role_id?: string | null;
  role_level?: number | null;
  level_title?: string | null;
  member_type?: string;
  status?: string;
}

export function useAuth() {
  const { data: response, error, isLoading } = useSWR('/auth/me', fetcher, {
    shouldRetryOnError: false
  });

  const user: User | null = response?.data ?? null;
  const role: Role | null = user?.role ?? null;

  const isAdmin = role === 'admin' || role === 'superadmin';
  const isSuperAdmin = role === 'superadmin';
  const isEditor = role === 'editor' || (user?.role_level !== null && user?.role_level !== undefined);
  const isViewer = role === 'viewer';

  return {
    user,
    role,
    isLoading,
    error,
    isAdmin,
    isSuperAdmin,
    isEditor,
    isViewer,
    canEdit: isAdmin || isEditor,
    canCreateMeeting: isAdmin || isEditor,
    canManageTemplates: isAdmin || isEditor,
    canManageUsers: isAdmin || isEditor,
    canEditOnlineLink: !isViewer,
  };
}
