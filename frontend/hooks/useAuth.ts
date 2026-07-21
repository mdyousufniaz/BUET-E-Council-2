import useSWR from 'swr';
import { fetcher } from '../lib/api';

export type Role = 'admin' | 'moderator' | 'viewer' | 'superadmin';

export function useAuth() {
  const { data: response, error, isLoading } = useSWR('/auth/me', fetcher, {
    shouldRetryOnError: false
  });

  const user = response?.data ?? null;
  const role: Role | null = user?.role ?? null;

  return {
    user,
    role,
    isLoading,
    error,
    // admin, superadmin, and moderator ("staff") can create/edit/delete; viewers are read-only.
    canEdit: role === 'admin' || role === 'moderator' || role === 'superadmin',
    // superadmin can do everything admin can, so it satisfies isAdmin checks too.
    isAdmin: role === 'admin' || role === 'superadmin',
    isSuperAdmin: role === 'superadmin',
  };
}
