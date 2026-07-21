// Client-side mirror of the meeting_service approval-escalation gates
// (middlewares/meetingWorkflowMiddleware.js + meetingController transitions).
// These decide which controls to render; the backend re-enforces every rule.

import type { Role } from '../hooks/useAuth';

export type MeetingStage = 'initiator' | 'moderator' | 'admin' | 'approved';
export type ReturnTarget = 'initiator' | 'moderator';

export interface WorkflowUser {
  id?: string;
  role?: Role | null;
}

export interface WorkflowMeeting {
  created_by?: string | null;
  stage?: MeetingStage | null;
  moderator_can_return?: boolean;
  is_locked?: boolean;
  status?: string | null;
  resolution_approved?: boolean;
}

export const isAdminRole = (user?: WorkflowUser | null): boolean =>
  user?.role === 'admin' || user?.role === 'superadmin';

export const isMeetingOwner = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): boolean =>
  !!(user?.id && meeting?.created_by && String(user.id) === String(meeting.created_by));

const stageOf = (meeting?: WorkflowMeeting | null): MeetingStage =>
  (meeting?.stage ?? 'initiator') as MeetingStage;

// Who currently "holds" the file at its stage may edit it:
//   initiator stage -> the initiator who created it
//   moderator stage -> any moderator
//   admin / approved -> admin/superadmin only
// admin/superadmin may always edit. Never while locked.
export const canEditMeeting = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): boolean => {
  if (!user || !meeting || meeting.is_locked) return false;
  if (isAdminRole(user)) return true;
  const stage = stageOf(meeting);
  if (stage === 'initiator') return isMeetingOwner(user, meeting);
  if (stage === 'moderator') return user.role === 'moderator';
  return false;
};

// Back-compat aliases used by the meeting view components. In Phase 1 authoring
// and operating share the same stage rules.
export const canAuthorMeeting = canEditMeeting;
export const canOperateMeeting = canEditMeeting;

// If the current user can forward the file one step up, returns the destination
// role label ('moderator' or 'admin'); otherwise null.
export const submitTarget = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): 'moderator' | 'admin' | null => {
  if (!user || !meeting || meeting.is_locked) return null;
  const stage = stageOf(meeting);
  if (stage === 'initiator' && (isAdminRole(user) || isMeetingOwner(user, meeting))) return 'moderator';
  if (stage === 'moderator' && (isAdminRole(user) || user.role === 'moderator')) return 'admin';
  return null;
};

// admin/superadmin final approval, only once the file has reached the admin stage.
export const canApproveMeeting = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): boolean =>
  !!user && !!meeting && !meeting.is_locked && isAdminRole(user) && stageOf(meeting) === 'admin';

// Which lower stages the current user may hand the file back down to.
//   admin/superadmin: moderator/initiator from admin & approved; initiator from moderator.
//   moderator: initiator, only if an admin handed it back (moderator_can_return).
export const returnTargets = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): ReturnTarget[] => {
  if (!user || !meeting || meeting.is_locked) return [];
  const stage = stageOf(meeting);
  if (isAdminRole(user)) {
    if (stage === 'moderator') return ['initiator'];
    if (stage === 'admin' || stage === 'approved') return ['moderator', 'initiator'];
    return [];
  }
  if (user.role === 'moderator' && stage === 'moderator' && meeting.moderator_can_return) {
    return ['initiator'];
  }
  return [];
};

// --- Resolution / attendance phase (Phase 2) ---------------------------------
// Open only after the agenda is approved and the meeting is set "ongoing",
// until an admin approves the resolution.

const resolutionPhaseOpen = (meeting?: WorkflowMeeting | null): boolean =>
  !!meeting && !meeting.is_locked && meeting.stage === 'approved' &&
  meeting.status === 'ongoing' && !meeting.resolution_approved;

export const canEditResolution = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): boolean => {
  if (!user || !resolutionPhaseOpen(meeting)) return false;
  return isAdminRole(user) || isMeetingOwner(user, meeting) || user.role === 'moderator';
};

export const canApproveResolution = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): boolean =>
  isAdminRole(user) && resolutionPhaseOpen(meeting);

export const canReopenResolution = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): boolean =>
  isAdminRole(user) && !!meeting && !meeting.is_locked && !!meeting.resolution_approved;

export const STAGE_LABELS: Record<MeetingStage, string> = {
  initiator: 'Draft — with initiator',
  moderator: 'With moderator',
  admin: 'With admin',
  approved: 'Approved',
};

// Tailwind classes for a status badge (light + dark friendly).
export const STAGE_BADGE_CLASSES: Record<MeetingStage, string> = {
  initiator: 'bg-muted text-muted-foreground',
  moderator: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  admin: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
};
