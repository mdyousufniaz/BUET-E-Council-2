import type { Role } from '../hooks/useAuth';

export interface WorkflowUser {
  id?: string;
  role?: Role | null;
  role_id?: string | null;
  role_level?: number | null;
  level_title?: string | null;
}

export interface WorkflowMeeting {
  id?: string;
  created_by?: string | null;
  agenda_handover_level?: number | null;
  suppli_agenda_handover_level?: number | null;
  resolution_handover_level?: number | null;
  resolution_status_handover_level?: number | null;
  agenda_locked_level?: number | null;
  suppli_agenda_locked_level?: number | null;
  resolution_locked_level?: number | null;
  resolution_status_locked_level?: number | null;
  meeting_locked_level?: number | null;
  invitees_locked_level?: number | null;
  presentees_locked_level?: number | null;
  conclusion_locked_level?: number | null;
  is_completed?: boolean;
  completed_at?: string | null;
  completed_by?: string | null;
  access?: {
    canEditMeeting: boolean;
    canEditAgenda: boolean;
    canEditSuppliAgenda: boolean;
    canEditResolution: boolean;
    canEditResolutionStatus: boolean;
    canEditInvitees: boolean;
    canEditPresentees: boolean;
    canEditConclusion: boolean;
    canMarkCompleted: boolean;
    canHandoverAgenda: boolean;
    canHandoverSuppliAgenda: boolean;
    canHandoverResolution: boolean;
    canHandoverResolutionStatus: boolean;
    canLockAgenda: boolean;
    canLockSuppliAgenda: boolean;
    canLockResolution: boolean;
    canLockResolutionStatus: boolean;
    canLockMeeting: boolean;
    canLockInvitees: boolean;
    canLockPresentees: boolean;
    canLockConclusion: boolean;
    canUnlockAgenda: boolean;
    canUnlockSuppliAgenda: boolean;
    canUnlockResolution: boolean;
    canUnlockResolutionStatus: boolean;
    canUnlockMeeting: boolean;
    canUnlockInvitees: boolean;
    canUnlockPresentees: boolean;
    canUnlockConclusion: boolean;
  };
}

export const isAdminRole = (user?: WorkflowUser | null): boolean =>
  user?.role === 'admin';

export const isCompleted = (meeting?: WorkflowMeeting | null): boolean =>
  meeting?.is_completed === true;

export const canUnlockItem = (user?: WorkflowUser | null, lockedLevel?: number | null): boolean => {
  if (lockedLevel === null || lockedLevel === undefined) return true;
  if (!user) return false;
  if (isAdminRole(user)) return true;
  if (user.role_level === null || user.role_level === undefined) return false;
  return Number(user.role_level) >= Number(lockedLevel);
};

export const canSendBack = (user?: WorkflowUser | null, handoverLevel?: number | null): boolean => {
  if (handoverLevel === null || handoverLevel === undefined) return false;
  if (!user) return false;
  if (isAdminRole(user)) return true;
  if (user.role_level === null || user.role_level === undefined) return false;
  return Number(user.role_level) > Number(handoverLevel);
};

export const canEditMeeting = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): boolean => {
  if (!user || !meeting) return false;
  if (meeting.access) return meeting.access.canEditMeeting;
  if (isAdminRole(user)) return true;
  if (user.role === 'viewer') return false;
  if (user.role_level === null || user.role_level === undefined) return false;

  const userLevel = Number(user.role_level);
  if (meeting.meeting_locked_level !== null && meeting.meeting_locked_level !== undefined) {
    return userLevel >= Number(meeting.meeting_locked_level);
  }
  return true;
};

export const canAuthorMeeting = canEditMeeting;
export const canOperateMeeting = canEditMeeting;

export const canEditAgenda = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): boolean => {
  if (!user || !meeting) return false;
  if (meeting.access) return meeting.access.canEditAgenda;
  if (isAdminRole(user)) return true;
  if (user.role === 'viewer') return false;
  if (user.role_level === null || user.role_level === undefined) return false;

  const userLevel = Number(user.role_level);
  if (meeting.agenda_handover_level !== null && meeting.agenda_handover_level !== undefined) {
    if (userLevel <= Number(meeting.agenda_handover_level)) return false;
  }
  if (meeting.agenda_locked_level !== null && meeting.agenda_locked_level !== undefined) {
    if (userLevel < Number(meeting.agenda_locked_level)) return false;
  }
  return true;
};

export const canEditSuppliAgenda = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): boolean => {
  if (!user || !meeting) return false;
  if (meeting.access) return meeting.access.canEditSuppliAgenda;
  if (isAdminRole(user)) return true;
  if (user.role === 'viewer') return false;
  if (user.role_level === null || user.role_level === undefined) return false;

  const userLevel = Number(user.role_level);
  if (meeting.suppli_agenda_handover_level !== null && meeting.suppli_agenda_handover_level !== undefined) {
    if (userLevel <= Number(meeting.suppli_agenda_handover_level)) return false;
  }
  if (meeting.suppli_agenda_locked_level !== null && meeting.suppli_agenda_locked_level !== undefined) {
    if (userLevel < Number(meeting.suppli_agenda_locked_level)) return false;
  }
  return true;
};

export const canEditResolution = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): boolean => {
  if (!user || !meeting) return false;
  if (meeting.access) return meeting.access.canEditResolution;
  if (isAdminRole(user)) return true;
  if (user.role === 'viewer') return false;
  if (user.role_level === null || user.role_level === undefined) return false;

  const userLevel = Number(user.role_level);
  if (meeting.resolution_handover_level !== null && meeting.resolution_handover_level !== undefined) {
    if (userLevel <= Number(meeting.resolution_handover_level)) return false;
  }
  if (meeting.resolution_locked_level !== null && meeting.resolution_locked_level !== undefined) {
    if (userLevel < Number(meeting.resolution_locked_level)) return false;
  }
  return true;
};

export const canEditResolutionStatus = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): boolean => {
  if (!user || !meeting) return false;
  if (meeting.access) return meeting.access.canEditResolutionStatus;
  if (isAdminRole(user)) return true;
  if (user.role === 'viewer') return false;
  if (user.role_level === null || user.role_level === undefined) return false;

  const userLevel = Number(user.role_level);
  if (meeting.resolution_status_handover_level !== null && meeting.resolution_status_handover_level !== undefined) {
    if (userLevel <= Number(meeting.resolution_status_handover_level)) return false;
  }
  if (meeting.resolution_status_locked_level !== null && meeting.resolution_status_locked_level !== undefined) {
    if (userLevel < Number(meeting.resolution_status_locked_level)) return false;
  }
  return true;
};

export const canEditInvitees = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): boolean => {
  if (!user || !meeting) return false;
  if (meeting.access) return meeting.access.canEditInvitees;
  if (isAdminRole(user)) return true;
  if (user.role === 'viewer') return false;
  if (user.role_level === null || user.role_level === undefined) return false;

  const userLevel = Number(user.role_level);
  if (meeting.invitees_locked_level !== null && meeting.invitees_locked_level !== undefined) {
    return userLevel >= Number(meeting.invitees_locked_level);
  }
  return true;
};

export const canEditPresentees = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): boolean => {
  if (!user || !meeting) return false;
  if (meeting.access) return meeting.access.canEditPresentees;
  if (isAdminRole(user)) return true;
  if (user.role === 'viewer') return false;
  if (user.role_level === null || user.role_level === undefined) return false;

  const userLevel = Number(user.role_level);
  if (meeting.presentees_locked_level !== null && meeting.presentees_locked_level !== undefined) {
    return userLevel >= Number(meeting.presentees_locked_level);
  }
  return true;
};

export const canEditConclusion = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null): boolean => {
  if (!user || !meeting) return false;
  if (meeting.access) return meeting.access.canEditConclusion;
  if (isAdminRole(user)) return true;
  if (user.role === 'viewer') return false;
  if (user.role_level === null || user.role_level === undefined) return false;

  const userLevel = Number(user.role_level);
  if (meeting.conclusion_locked_level !== null && meeting.conclusion_locked_level !== undefined) {
    return userLevel >= Number(meeting.conclusion_locked_level);
  }
  return true;
};

export const canCompleteMeeting = (user?: WorkflowUser | null, meeting?: WorkflowMeeting | null, minLevel = 1): boolean => {
  if (!user || !meeting) return false;
  if (isCompleted(meeting)) return false;
  if (isAdminRole(user)) return true;
  if (user.role === 'viewer') return false;
  if (meeting.access && typeof meeting.access.canMarkCompleted === 'boolean') {
    return meeting.access.canMarkCompleted;
  }
  if (user.role_level === null || user.role_level === undefined) return false;
  return Number(user.role_level) >= minLevel;
};
