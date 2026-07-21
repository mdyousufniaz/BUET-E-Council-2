import useSWR from 'swr';
import { fetcher } from '../lib/api';

export type Role = 'admin' | 'superadmin' | 'moderator' | 'file_initiator' | 'viewer';

export function useAuth() {
  const { data: response, error, isLoading } = useSWR('/auth/me', fetcher, {
    shouldRetryOnError: false
  });

  const user = response?.data ?? null;
  const role: Role | null = user?.role ?? null;

  // superadmin can do everything admin can, so it satisfies isAdmin checks too.
  const isAdmin = role === 'admin' || role === 'superadmin';
  const isSuperAdmin = role === 'superadmin';
  const isModerator = role === 'moderator';
  const isInitiator = role === 'file_initiator';

  return {
    user,
    role,
    isLoading,
    error,
    isAdmin,
    isSuperAdmin,
    isModerator,
    isInitiator,
    // Generic "staff can manage the structural admin pages" (members,
    // departments, faculties, offices, templates, users). Meeting/agenda
    // authoring is gated separately by ownership + approval status via
    // lib/meetingAccess.ts (canAuthorMeeting / canOperateMeeting).
    canEdit: isAdmin || isModerator,
    // Who may create a brand-new meeting file: initiators and admins.
    canCreateMeeting: isAdmin || isInitiator,
    // Who may review (approve / send back) a submitted file.
    canReview: isAdmin || isModerator,
  };
}
