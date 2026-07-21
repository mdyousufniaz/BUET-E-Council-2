// Client-side mirror of the meeting_service approval-workflow gates
// (middlewares/meetingWorkflowMiddleware.js). These decide which controls to
// render; the backend re-enforces every rule, so this is UX only.

import type { Role } from '../hooks/useAuth';

export type ApprovalStatus = 'draft' | 'submitted' | 'approved' | 'sent_back';

export interface WorkflowUser {
  id?: string;
  role?: Role | null;
}

export interface WorkflowMeeting {
  created_by?: string | null;
  approval_status?: ApprovalStatus | null;
  is_locked?: boolean;
}

const EDITABLE_STATUSES: ApprovalStatus[] = ['draft', 'sent_back'];

export const isMeetingOwner = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): boolean =>
  !!(user?.id && meeting?.created_by && String(user.id) === String(meeting.created_by));

// May edit the file's *content* (meeting info, agenda items). Owner-only while
// the file is draft/sent_back, or admin. Never while locked.
export const canAuthorMeeting = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): boolean => {
  if (!user || !meeting || meeting.is_locked) return false;
  if ((user.role === 'admin' || user.role === 'superadmin')) return true;
  if (user.role === 'file_initiator' && isMeetingOwner(user, meeting)) {
    return EDITABLE_STATUSES.includes((meeting.approval_status ?? 'draft') as ApprovalStatus);
  }
  return false;
};

// May run operational actions across the file's whole lifecycle (invitees,
// presentees, attendance, resolutions, materials). Owner or admin.
export const canOperateMeeting = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): boolean => {
  if (!user || !meeting || meeting.is_locked) return false;
  if ((user.role === 'admin' || user.role === 'superadmin')) return true;
  return user.role === 'file_initiator' && isMeetingOwner(user, meeting);
};

// May submit the file for review.
export const canSubmitMeeting = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): boolean => {
  if (!user || !meeting || meeting.is_locked) return false;
  const editable = EDITABLE_STATUSES.includes((meeting.approval_status ?? 'draft') as ApprovalStatus);
  if (!editable) return false;
  if ((user.role === 'admin' || user.role === 'superadmin')) return true;
  return user.role === 'file_initiator' && isMeetingOwner(user, meeting);
};

// May approve / send back a submitted file.
export const canReviewMeeting = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): boolean => {
  if (!user || !meeting) return false;
  return ((user.role === 'admin' || user.role === 'superadmin') || user.role === 'moderator') && meeting.approval_status === 'submitted';
};

export const APPROVAL_LABELS: Record<ApprovalStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted for review',
  approved: 'Approved',
  sent_back: 'Sent back for corrections',
};

// Tailwind classes for a status badge (light + dark friendly).
export const APPROVAL_BADGE_CLASSES: Record<ApprovalStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  submitted: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  sent_back: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
};
