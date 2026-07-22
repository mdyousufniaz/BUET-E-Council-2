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
  return_source?: 'moderator' | 'admin' | null;
  moderator_note?: string | null;
  admin_note?: string | null;
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
//
// admin/superadmin never get this button: they are the approving authority and
// have nobody above them to send a file to.
export const submitTarget = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): 'moderator' | 'admin' | null => {
  if (!user || !meeting || meeting.is_locked || isAdminRole(user)) return null;
  const stage = stageOf(meeting);
  if (stage === 'initiator' && isMeetingOwner(user, meeting)) {
    // Re-submit to whoever granted access; a fresh file goes to the moderator.
    return meeting.return_source === 'admin' ? 'admin' : 'moderator';
  }
  if (stage === 'moderator' && user.role === 'moderator') return 'admin';
  return null;
};

// admin/superadmin final approval. They can approve from any stage — a file the
// moderator escalated to them, or one they authored themselves (which never
// leaves the initiator stage since admins never submit).
export const canApproveMeeting = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): boolean =>
  !!user && !!meeting && !meeting.is_locked && isAdminRole(user) && stageOf(meeting) !== 'approved';

// Which lower stages the current user may hand the file back down to, granting
// that party edit access.
//   admin/superadmin: any stage they don't already hold — including re-opening
//     an approved file for the moderator or the initiator to modify.
//   moderator: initiator, whenever the file is at the moderator stage.
export const returnTargets = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): ReturnTarget[] => {
  if (!user || !meeting || meeting.is_locked) return [];
  const stage = stageOf(meeting);
  if (isAdminRole(user)) {
    return (['moderator', 'initiator'] as ReturnTarget[]).filter((t) => t !== stage);
  }
  if (user.role === 'moderator' && stage === 'moderator') {
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
