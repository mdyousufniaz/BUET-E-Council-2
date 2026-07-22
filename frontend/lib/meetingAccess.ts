// Client-side mirror of the meeting_service approval gates
// (middlewares/meetingWorkflowMiddleware.js + meetingController transitions).
// These decide which controls to render; the backend re-enforces every rule.
//
// A meeting file runs TWO escalation chains, one after the other:
//   1. the agenda, on `stage`           — while status is 'draft'
//   2. the resolution, on `resolution_stage` — once the agenda is approved,
//      which is what makes the status 'ongoing'
// Both use the same initiator -> moderator -> admin route. 'past' (set only by
// "Mark Meeting Completed") closes everything to everyone but a superadmin.

import type { Role } from '../hooks/useAuth';

export type MeetingStage = 'initiator' | 'moderator' | 'admin' | 'approved';
export type ReturnTarget = 'initiator' | 'moderator';
// What the badge shows. Initiators never see past 'forwarded' — the server
// collapses every stage above their own into it (see displayStageFor).
export type DisplayStage = MeetingStage | 'forwarded';
export type MeetingStatus = 'draft' | 'ongoing' | 'past';

export interface WorkflowUser {
  id?: string;
  role?: Role | null;
}

export interface WorkflowMeeting {
  created_by?: string | null;
  status?: MeetingStatus | null;
  // Agenda chain
  stage?: MeetingStage | null;
  display_stage?: DisplayStage | null;
  return_source?: 'moderator' | 'admin' | null;
  moderator_note?: string | null;
  admin_note?: string | null;
  // Resolution chain
  resolution_stage?: MeetingStage | null;
  resolution_return_source?: 'moderator' | 'admin' | null;
  resolution_moderator_note?: string | null;
  resolution_admin_note?: string | null;
}

export const isAdminRole = (user?: WorkflowUser | null): boolean =>
  user?.role === 'admin' || user?.role === 'superadmin';

export const isSuperAdmin = (user?: WorkflowUser | null): boolean =>
  user?.role === 'superadmin';

export const isMeetingOwner = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): boolean =>
  !!(user?.id && meeting?.created_by && String(user.id) === String(meeting.created_by));

// Completing a meeting is the final lock — it replaced the old manual "lock
// meeting" toggle. This is the one place admin and superadmin differ: the
// superadmin keeps an escape hatch for a mis-click.
export const isCompleted = (meeting?: WorkflowMeeting | null): boolean =>
  meeting?.status === 'past';

const stageOf = (meeting?: WorkflowMeeting | null): MeetingStage =>
  (meeting?.stage ?? 'initiator') as MeetingStage;

const resolutionStageOf = (meeting?: WorkflowMeeting | null): MeetingStage =>
  (meeting?.resolution_stage ?? 'initiator') as MeetingStage;

// Position-in-the-chain rule, shared by both chains. 'approved' means the chain
// is finished and nobody edits — admins included; they reopen it by sending it
// back down. A moderator keeps access after handing the file to the initiator.
const holderCanEdit = (
  user: WorkflowUser | null | undefined,
  meeting: WorkflowMeeting | null | undefined,
  stage: MeetingStage,
  returnSource?: 'moderator' | 'admin' | null,
): boolean => {
  if (stage === 'approved') return false;
  if (isAdminRole(user)) return true;
  if (stage === 'initiator') {
    return isMeetingOwner(user, meeting) ||
      (user?.role === 'moderator' && returnSource === 'moderator');
  }
  if (stage === 'moderator') return user?.role === 'moderator';
  return false;
};

// --- Agenda phase ------------------------------------------------------------

export const canEditMeeting = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): boolean => {
  if (!user || !meeting) return false;
  if (isCompleted(meeting)) return isSuperAdmin(user);
  return holderCanEdit(user, meeting, stageOf(meeting), meeting.return_source);
};

// Back-compat aliases used by the meeting view components.
export const canAuthorMeeting = canEditMeeting;
export const canOperateMeeting = canEditMeeting;

// admin/superadmin never get a submit button — they are the approving authority.
export const submitTarget = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): 'moderator' | 'admin' | null => {
  if (!user || !meeting || isCompleted(meeting) || isAdminRole(user)) return null;
  const stage = stageOf(meeting);
  if (stage === 'initiator' && isMeetingOwner(user, meeting)) {
    // Re-submit to whoever granted access; a fresh file goes to the moderator.
    return meeting.return_source === 'admin' ? 'admin' : 'moderator';
  }
  if (stage === 'moderator' && user.role === 'moderator') return 'admin';
  return null;
};

// Approving the agenda is also what starts the meeting (status -> 'ongoing').
export const canApproveMeeting = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): boolean =>
  !!user && !!meeting && !isCompleted(meeting) && isAdminRole(user) && stageOf(meeting) !== 'approved';

// Which lower stages the current user may hand the file back down to, granting
// that party edit access. Sending an approved agenda back reopens it and
// returns the meeting to 'draft'.
export const returnTargets = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): ReturnTarget[] => {
  if (!user || !meeting || isCompleted(meeting)) return [];
  const stage = stageOf(meeting);
  if (isAdminRole(user)) {
    return (['moderator', 'initiator'] as ReturnTarget[]).filter((t) => t !== stage);
  }
  if (user.role === 'moderator' && stage === 'moderator') return ['initiator'];
  return [];
};

// --- Resolution phase --------------------------------------------------------
// Opens only once the agenda is approved (status 'ongoing'), then runs the same
// chain on resolution_stage. Reaching 'approved' freezes the resolution.

export const resolutionPhaseOpen = (meeting?: WorkflowMeeting | null): boolean =>
  !!meeting && !isCompleted(meeting) && meeting.stage === 'approved' && meeting.status === 'ongoing';

export const canEditResolution = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): boolean => {
  if (!user || !meeting) return false;
  if (isCompleted(meeting)) return isSuperAdmin(user);
  if (!resolutionPhaseOpen(meeting)) return false;
  return holderCanEdit(user, meeting, resolutionStageOf(meeting), meeting.resolution_return_source);
};

export const resolutionSubmitTarget = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): 'moderator' | 'admin' | null => {
  if (!user || !resolutionPhaseOpen(meeting) || isAdminRole(user)) return null;
  const stage = resolutionStageOf(meeting);
  if (stage === 'initiator' && isMeetingOwner(user, meeting)) {
    return meeting?.resolution_return_source === 'admin' ? 'admin' : 'moderator';
  }
  if (stage === 'moderator' && user.role === 'moderator') return 'admin';
  return null;
};

export const canApproveResolution = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): boolean =>
  isAdminRole(user) && resolutionPhaseOpen(meeting) && resolutionStageOf(meeting) !== 'approved';

export const canReopenResolution = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): boolean =>
  isAdminRole(user) && !!meeting && !isCompleted(meeting) && resolutionStageOf(meeting) === 'approved';

export const resolutionReturnTargets = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): ReturnTarget[] => {
  if (!user || !resolutionPhaseOpen(meeting)) return [];
  const stage = resolutionStageOf(meeting);
  if (isAdminRole(user)) {
    return (['moderator', 'initiator'] as ReturnTarget[]).filter((t) => t !== stage);
  }
  if (user.role === 'moderator' && stage === 'moderator') return ['initiator'];
  return [];
};

// --- Completion --------------------------------------------------------------

// Only admin/superadmin close a meeting, and only once it isn't already closed.
export const canCompleteMeeting = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): boolean =>
  isAdminRole(user) && !!meeting && !isCompleted(meeting);

// --- Labels ------------------------------------------------------------------

export const STAGE_LABELS: Record<DisplayStage, string> = {
  initiator: 'Draft — with initiator',
  moderator: 'With moderator',
  admin: 'With admin',
  approved: 'Approved',
  forwarded: 'Forwarded to moderator',
};

export const RESOLUTION_STAGE_LABELS: Record<DisplayStage, string> = {
  initiator: 'Resolution — with initiator',
  moderator: 'Resolution — with moderator',
  admin: 'Resolution — with admin',
  approved: 'Resolution approved — locked',
  forwarded: 'Resolution — forwarded to moderator',
};

// Tailwind classes for a status badge (light + dark friendly).
export const STAGE_BADGE_CLASSES: Record<DisplayStage, string> = {
  initiator: 'bg-muted text-muted-foreground',
  moderator: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  admin: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  forwarded: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
};

export const STATUS_LABELS: Record<MeetingStatus, string> = {
  draft: 'Draft',
  ongoing: 'Ongoing',
  past: 'Completed',
};

export const STATUS_BADGE_CLASSES: Record<MeetingStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  ongoing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  past: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
};

// The badge value to render for the current viewer: the server-masked
// display_stage when present, otherwise the real stage.
export const badgeStage = (meeting?: WorkflowMeeting | null): DisplayStage =>
  (meeting?.display_stage ?? meeting?.stage ?? 'initiator') as DisplayStage;
