"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import api, { fetcher } from "../../lib/api";
import SearchableSelect from "../SearchableSelect";
import CustomSelect from "../CustomSelect";
import { toast } from "sonner";
import { useConfirm } from "../../hooks/useConfirm";
import { useAuth } from "../../hooks/useAuth";
import { canAuthorMeeting, canCompleteMeeting, canUnlockItem } from "../../lib/meetingAccess";
import { Trash2, Video, Lock, Unlock, ArrowRightLeft, CheckCircle2, ShieldAlert, CornerDownLeft, Clock, Users, UserCheck, FileText, Layers, KeyRound } from "lucide-react";

const typeOptions = [
  { value: "syndicate", label: "Syndicate" },
  { value: "academic", label: "Academic" }
];

const statusOptions = [
  { value: "draft", label: "Draft" },
  { value: "ongoing", label: "Ongoing" }
];

export default function MeetingInfoView({ meeting, mutate }: { meeting: any, mutate: any }) {
  const router = useRouter();
  const { confirm, ConfirmModal } = useConfirm();
  const { isAdmin, user, canEditOnlineLink } = useAuth();

  // Fetch role levels to populate lower-level titles for Send Back and badges
  const { data: rolesRes } = useSWR('/auth/roles', fetcher);
  const allRoles: any[] = rolesRes?.data || [];

  const userLevel = user?.role_level !== null && user?.role_level !== undefined ? Number(user.role_level) : 999;
  const lowerRoles = allRoles.filter((r: any) => isAdmin || Number(r.level) < userLevel);

  const [selectedTargetLevel, setSelectedTargetLevel] = useState<string>("");

  useEffect(() => {
    if (lowerRoles.length > 0 && !selectedTargetLevel) {
      setSelectedTargetLevel(String(lowerRoles[0].level));
    }
  }, [lowerRoles, selectedTargetLevel]);

  const [formData, setFormData] = useState({
    title: meeting.title || "",
    meeting_title: meeting.meeting_title || "",
    meeting_date: meeting.meeting_date ? new Date(meeting.meeting_date).toISOString().split('T')[0] : "",
    type: meeting.type || "syndicate",
    status: meeting.status || "draft",
    agenda_prefix: meeting.agenda_prefix || ""
  });

  useEffect(() => {
    setFormData({
      title: meeting.title || "",
      meeting_title: meeting.meeting_title || "",
      meeting_date: meeting.meeting_date ? new Date(meeting.meeting_date).toISOString().split('T')[0] : "",
      type: meeting.type || "syndicate",
      status: meeting.status || "draft",
      agenda_prefix: meeting.agenda_prefix || ""
    });
  }, [meeting]);

  const [onlineMeetingLink, setOnlineMeetingLink] = useState(meeting.online_meeting_link || "");

  const [saving, setSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCompleteModalOpen, setIsCompleteModalOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState("");
  const [isCompleting, setIsCompleting] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Password confirmation modal for Handover
  const [isHandoverModalOpen, setIsHandoverModalOpen] = useState(false);
  const [handoverEndpoint, setHandoverEndpoint] = useState("");
  const [handoverSuccessMsg, setHandoverSuccessMsg] = useState("");
  const [handoverPassword, setHandoverPassword] = useState("");
  const [isSubmittingHandover, setIsSubmittingHandover] = useState(false);

  const canEdit = canAuthorMeeting(user, meeting);
  const readOnly = !canEdit;

  const access = meeting.access || {};
  const isPast = meeting.status === 'past' || meeting.is_completed === true;

  const handleDelete = () => {
    confirm("Delete Meeting", "Are you sure you want to delete this meeting? This action cannot be undone.", async () => {
      setIsDeleting(true);
      try {
        await api.delete(`/meetings/${meeting.id}`);
        toast.success("Meeting deleted successfully.");
        router.push('/workspace/meetings');
      } catch (err: any) {
        toast.error(err.response?.data?.message || 'Failed to delete meeting');
      } finally {
        setIsDeleting(false);
      }
    });
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaving(true);
    try {
      const requests = [];
      if (!readOnly) {
        const payload = {
          ...formData,
          meeting_date: new Date(formData.meeting_date).toISOString()
        };
        requests.push(api.put(`/meetings/${meeting.id}`, payload));
      }
      if (canEditOnlineLink) {
        requests.push(api.put(`/meetings/${meeting.id}/online-link`, { online_meeting_link: onlineMeetingLink.trim() || null }));
      }
      await Promise.all(requests);
      mutate();
      toast.success("Meeting info updated successfully.");
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to update meeting info');
    } finally {
      setSaving(false);
    }
  };

  // Helper function to resolve level integer to level_title
  const getLevelTitle = (lvl: number | null | undefined) => {
    if (lvl === null || lvl === undefined) return null;
    const r = allRoles.find((role: any) => Number(role.level) === Number(lvl));
    return r ? r.level_title : `Level ${lvl}`;
  };

  // Handover Trigger with Password Confirmation Modal
  const openHandoverModal = (endpoint: string, successMessage: string) => {
    setHandoverEndpoint(endpoint);
    setHandoverSuccessMsg(successMessage);
    setHandoverPassword("");
    setIsHandoverModalOpen(true);
  };

  const handleHandoverSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!handoverPassword) {
      toast.error("Password confirmation is required for handover.");
      return;
    }
    setIsSubmittingHandover(true);
    try {
      await api.post(`/meetings/${meeting.id}/${handoverEndpoint}`, { password: handoverPassword });
      toast.success(handoverSuccessMsg);
      mutate();
      setIsHandoverModalOpen(false);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Handover failed. Check your password.');
    } finally {
      setIsSubmittingHandover(false);
    }
  };

  // Action Handlers for Locking & Unlocking
  const handleControlAction = async (endpoint: string, successMessage: string) => {
    setActionLoading(endpoint);
    try {
      await api.post(`/meetings/${meeting.id}/${endpoint}`);
      toast.success(successMessage);
      mutate();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Action failed');
    } finally {
      setActionLoading(null);
    }
  };

  // Send Back Handlers
  const handleSendBack = async (component: 'agenda' | 'suppli-agenda' | 'resolution' | 'resolution-status') => {
    if (!selectedTargetLevel && lowerRoles.length > 0) {
      toast.error("Please select a target lower level role.");
      return;
    }
    const targetLvl = selectedTargetLevel ? parseInt(selectedTargetLevel, 10) : (lowerRoles[0]?.level ?? 1);
    const targetRoleObj = allRoles.find((r: any) => Number(r.level) === targetLvl);
    const targetTitle = targetRoleObj ? targetRoleObj.level_title : `Level ${targetLvl}`;

    const endpoint = `send-back-${component}`;
    setActionLoading(endpoint);
    try {
      await api.post(`/meetings/${meeting.id}/${endpoint}`, { target_level: targetLvl });
      toast.success(`Sent back ${component.replace('-', ' ')} to ${targetTitle}.`);
      mutate();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Send back failed');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCompleteMeeting = async () => {
    if (confirmTitle !== formData.title) {
      toast.error("Meeting Serial Number does not match confirmation.");
      return;
    }
    
    setIsCompleting(true);
    try {
      await api.post(`/meetings/${meeting.id}/complete`, { title: confirmTitle });
      mutate();
      toast.success("Meeting marked as completed. Members transferred from invitees to presentees.");
      setIsCompleteModalOpen(false);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to complete meeting');
    } finally {
      setIsCompleting(false);
    }
  };

  const currentTargetRoleObj = allRoles.find((r: any) => String(r.level) === selectedTargetLevel);
  const currentTargetTitle = currentTargetRoleObj ? currentTargetRoleObj.level_title : "Lower Level";

  return (
    <div className="max-w-6xl animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
      <ConfirmModal />
      
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Meeting Info</h2>
          <p className="text-sm text-muted-foreground">
            View and update meeting details, status, level-based controls, and send back access to lower role levels.
          </p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-3">
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="flex items-center gap-2 px-4 py-2 rounded-md font-medium text-sm transition-colors bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/30 disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" /> {isDeleting ? "Deleting..." : "Delete Meeting"}
            </button>
          </div>
        )}
      </div>

      {/* 2-Column Grid: Left (Meeting Info Form) | Right (Handover, Locking & Send-Back Section) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* LEFT COLUMN: MEETING INFO SECTION */}
        <div className="lg:col-span-2 bg-card border border-border shadow-sm rounded-lg p-6">
          <form onSubmit={handleSave} className="space-y-6">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="space-y-1 w-full sm:w-1/3">
                <label className="text-sm font-medium">Serial Number</label>
                <input
                  required
                  disabled={readOnly}
                  value={formData.title}
                  onChange={e => setFormData({...formData, title: e.target.value})} 
                  className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm disabled:opacity-50" 
                  placeholder='e.g., "304th"'
                />
              </div>
              
              <div className="space-y-1 w-full sm:w-2/3">
                <label className="text-sm font-medium">Meeting Title</label>
                <input
                  disabled={readOnly}
                  value={formData.meeting_title}
                  onChange={e => setFormData({...formData, meeting_title: e.target.value})} 
                  className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm disabled:opacity-50" 
                  placeholder='e.g., "Monthly General Meeting"'
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Date</label>
                <input 
                  required 
                  type="date"
                  disabled={readOnly}
                  value={formData.meeting_date}
                  onChange={e => setFormData({...formData, meeting_date: e.target.value})} 
                  className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm disabled:opacity-50" 
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Type</label>
                {readOnly ? (
                  <div className="w-full px-3 py-2 bg-input/20 border border-input rounded-md text-sm opacity-50 cursor-not-allowed">
                    {typeOptions.find(o => o.value === formData.type)?.label || formData.type}
                  </div>
                ) : (
                  <CustomSelect 
                    options={typeOptions}
                    value={formData.type}
                    onChange={(val) => setFormData({...formData, type: val})}
                  />
                )}
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Meeting Status</label>
                {isPast ? (
                  <div className="w-full px-3 py-2 bg-emerald-500/10 border border-emerald-500/30 rounded-md text-sm font-bold text-emerald-800 dark:text-emerald-300 cursor-not-allowed">
                    Past (Completed)
                  </div>
                ) : readOnly ? (
                  <div className="w-full px-3 py-2 bg-input/20 border border-input rounded-md text-sm opacity-50 cursor-not-allowed capitalize">
                    {formData.status}
                  </div>
                ) : (
                  <CustomSelect 
                    options={statusOptions}
                    value={formData.status}
                    onChange={(val) => setFormData({...formData, status: val})}
                  />
                )}
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">প্রস্তাব নং (Agenda Prefix)</label>
              <input
                disabled={readOnly}
                value={formData.agenda_prefix}
                onChange={e => setFormData({...formData, agenda_prefix: e.target.value})}
                className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm disabled:opacity-50"
                placeholder="e.g., ২১০৬ (same for every agendum in this meeting)"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium flex items-center gap-2">
                <Video className="w-4 h-4 text-primary" /> Online Meeting Link
              </label>
              {canEditOnlineLink ? (
                <input
                  type="url"
                  value={onlineMeetingLink}
                  onChange={e => setOnlineMeetingLink(e.target.value)}
                  placeholder="e.g., https://meet.google.com/xxx-xxxx-xxx"
                  className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm"
                />
              ) : meeting.online_meeting_link ? (
                <a
                  href={meeting.online_meeting_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-sm text-primary hover:underline break-all px-3 py-2"
                >
                  {meeting.online_meeting_link}
                </a>
              ) : (
                <p className="text-sm text-muted-foreground italic px-3 py-2">No online meeting link set.</p>
              )}
            </div>

            {(!readOnly || canEditOnlineLink) && (
              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-primary text-primary-foreground py-2 px-6 rounded-md font-medium shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50 text-sm"
                >
                  {saving ? "Saving..." : "Save Info Changes"}
                </button>
              </div>
            )}
          </form>
        </div>

        {/* RIGHT COLUMN: MEETING CONTROLS & SEND BACK SECTION (RIGHT OF MEETING INFO) */}
        <div className="lg:col-span-1 space-y-6">
          
          {/* STATUS & CONTROL CARD */}
          <div className="bg-card border border-border shadow-sm rounded-lg p-6 space-y-5">
            <h3 className="text-base font-bold flex items-center gap-2 border-b border-border pb-3">
              <ShieldAlert className="w-5 h-5 text-primary" /> Level Controls & Status
            </h3>

            {/* Completed Badge */}
            {isPast ? (
              <div className="p-3 bg-emerald-100 dark:bg-emerald-900/40 border border-emerald-300 dark:border-emerald-800 rounded-md text-emerald-800 dark:text-emerald-300 text-sm flex items-center gap-2 font-semibold">
                <CheckCircle2 className="w-5 h-5" /> Meeting Marked Completed (Past)
              </div>
            ) : (
              <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/40 rounded-md text-xs text-blue-900 dark:text-blue-200 space-y-1">
                <div className="font-semibold text-sm">Active Role Access</div>
                <div>Your Role: <span className="font-bold">{user?.role === 'admin' ? 'Admin' : (user?.level_title || 'Editor')}</span></div>
              </div>
            )}

            {!isPast && (
              <div className="space-y-4">
                
                {/* Handover Actions (Requires Password Confirmation) */}
                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase text-muted-foreground tracking-wider flex items-center gap-1.5">
                    <ArrowRightLeft className="w-3.5 h-3.5" /> Handover to Upper Levels
                  </div>
                  
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => openHandoverModal('handover-agenda', 'Main Agenda handed over to upper levels.')}
                      disabled={!access.canHandoverAgenda}
                      className="w-full text-left px-3 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-900 dark:text-amber-200 border border-amber-500/30 rounded-md text-xs font-medium transition-colors disabled:opacity-40 flex items-center justify-between"
                    >
                      <span>Handover Main Agenda</span>
                      {meeting.agenda_handover_level !== null && (
                        <span className="text-[10px] bg-amber-500/20 px-1.5 py-0.5 rounded font-bold">
                          Handed over ({getLevelTitle(meeting.agenda_handover_level)})
                        </span>
                      )}
                    </button>

                    <button
                      onClick={() => openHandoverModal('handover-suppli-agenda', 'Supplementary Agenda handed over to upper levels.')}
                      disabled={!access.canHandoverSuppliAgenda}
                      className="w-full text-left px-3 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-900 dark:text-amber-200 border border-amber-500/30 rounded-md text-xs font-medium transition-colors disabled:opacity-40 flex items-center justify-between"
                    >
                      <span>Handover Suppli Agenda</span>
                      {meeting.suppli_agenda_handover_level !== null && (
                        <span className="text-[10px] bg-amber-500/20 px-1.5 py-0.5 rounded font-bold">
                          Handed over ({getLevelTitle(meeting.suppli_agenda_handover_level)})
                        </span>
                      )}
                    </button>

                    <button
                      onClick={() => openHandoverModal('handover-resolution', 'Resolution handed over to upper levels.')}
                      disabled={!access.canHandoverResolution}
                      className="w-full text-left px-3 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-900 dark:text-amber-200 border border-amber-500/30 rounded-md text-xs font-medium transition-colors disabled:opacity-40 flex items-center justify-between"
                    >
                      <span>Handover Resolution</span>
                      {meeting.resolution_handover_level !== null && (
                        <span className="text-[10px] bg-amber-500/20 px-1.5 py-0.5 rounded font-bold">
                          Handed over ({getLevelTitle(meeting.resolution_handover_level)})
                        </span>
                      )}
                    </button>

                    <button
                      onClick={() => openHandoverModal('handover-resolution-status', 'Resolution Status handed over to upper levels.')}
                      disabled={!access.canHandoverResolutionStatus}
                      className="w-full text-left px-3 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-900 dark:text-amber-200 border border-amber-500/30 rounded-md text-xs font-medium transition-colors disabled:opacity-40 flex items-center justify-between"
                    >
                      <span>Handover Resolution Status</span>
                      {meeting.resolution_status_handover_level !== null && (
                        <span className="text-[10px] bg-amber-500/20 px-1.5 py-0.5 rounded font-bold">
                          Handed over ({getLevelTitle(meeting.resolution_status_handover_level)})
                        </span>
                      )}
                    </button>
                  </div>
                </div>

                <hr className="border-border" />

                {/* Send Back to Lower Level Actions */}
                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase text-muted-foreground tracking-wider flex items-center gap-1.5">
                    <CornerDownLeft className="w-3.5 h-3.5 text-blue-600" /> Send Back to Lower Level
                  </div>

                  {lowerRoles.length > 0 ? (
                    <div className="space-y-2 bg-muted/30 p-3 rounded-md border border-border">
                      <label className="text-[11px] font-medium text-muted-foreground block">
                        Select Target Role Title:
                      </label>
                      <CustomSelect
                        value={selectedTargetLevel}
                        onChange={(val) => setSelectedTargetLevel(val)}
                        options={lowerRoles.map((r: any) => ({
                          value: String(r.level),
                          label: r.level_title
                        }))}
                      />

                      <div className="flex flex-col gap-1.5 pt-1">
                        <button
                          onClick={() => handleSendBack('agenda')}
                          disabled={actionLoading === 'send-back-agenda'}
                          className="w-full text-left px-2.5 py-1.5 bg-blue-600/10 hover:bg-blue-600/20 text-blue-900 dark:text-blue-200 border border-blue-600/30 rounded text-xs font-medium transition-colors disabled:opacity-40"
                        >
                          Send Back Agenda to {currentTargetTitle}
                        </button>

                        <button
                          onClick={() => handleSendBack('suppli-agenda')}
                          disabled={actionLoading === 'send-back-suppli-agenda'}
                          className="w-full text-left px-2.5 py-1.5 bg-blue-600/10 hover:bg-blue-600/20 text-blue-900 dark:text-blue-200 border border-blue-600/30 rounded text-xs font-medium transition-colors disabled:opacity-40"
                        >
                          Send Back Suppli Agenda to {currentTargetTitle}
                        </button>

                        <button
                          onClick={() => handleSendBack('resolution')}
                          disabled={actionLoading === 'send-back-resolution'}
                          className="w-full text-left px-2.5 py-1.5 bg-blue-600/10 hover:bg-blue-600/20 text-blue-900 dark:text-blue-200 border border-blue-600/30 rounded text-xs font-medium transition-colors disabled:opacity-40"
                        >
                          Send Back Resolution to {currentTargetTitle}
                        </button>

                        <button
                          onClick={() => handleSendBack('resolution-status')}
                          disabled={actionLoading === 'send-back-resolution-status'}
                          className="w-full text-left px-2.5 py-1.5 bg-blue-600/10 hover:bg-blue-600/20 text-blue-900 dark:text-blue-200 border border-blue-600/30 rounded text-xs font-medium transition-colors disabled:opacity-40"
                        >
                          Send Back Resolution Status to {currentTargetTitle}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">No lower role titles available to send back to.</p>
                  )}
                </div>

                <hr className="border-border" />

                {/* Level Locking Controls */}
                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase text-muted-foreground tracking-wider flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5" /> Level Locking Controls
                  </div>

                  <div className="flex flex-col gap-2">
                    {/* 1. Lock / Unlock Meeting Info */}
                    {meeting.meeting_locked_level !== null ? (
                      <button
                        onClick={() => handleControlAction('unlock-meeting', 'Meeting Info unlocked.')}
                        disabled={!canUnlockItem(user, meeting.meeting_locked_level) || actionLoading === 'unlock-meeting'}
                        className="w-full text-left px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-900 dark:text-emerald-200 border border-emerald-500/30 rounded-md text-xs font-medium transition-colors disabled:opacity-40 flex items-center justify-between"
                      >
                        <span className="flex items-center gap-1.5"><Unlock className="w-3.5 h-3.5" /> Unlock Meeting Info</span>
                        <span className="text-[10px] bg-emerald-500/20 px-1.5 py-0.5 rounded font-bold">Locked by {getLevelTitle(meeting.meeting_locked_level)}</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleControlAction('lock-meeting', 'Meeting Info locked for lower levels.')}
                        disabled={!access.canLockMeeting || actionLoading === 'lock-meeting'}
                        className="w-full text-left px-3 py-2 bg-muted hover:bg-muted/80 text-foreground border border-border rounded-md text-xs font-medium transition-colors disabled:opacity-40 flex items-center justify-between"
                      >
                        <span className="flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> Lock Meeting Info</span>
                      </button>
                    )}

                    {/* 2. Lock / Unlock Main Agenda */}
                    {meeting.agenda_locked_level !== null ? (
                      <button
                        onClick={() => handleControlAction('unlock-agenda', 'Main Agenda unlocked.')}
                        disabled={!canUnlockItem(user, meeting.agenda_locked_level) || actionLoading === 'unlock-agenda'}
                        className="w-full text-left px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-900 dark:text-emerald-200 border border-emerald-500/30 rounded-md text-xs font-medium transition-colors disabled:opacity-40 flex items-center justify-between"
                      >
                        <span className="flex items-center gap-1.5"><Unlock className="w-3.5 h-3.5" /> Unlock Main Agenda</span>
                        <span className="text-[10px] bg-emerald-500/20 px-1.5 py-0.5 rounded font-bold">Locked by {getLevelTitle(meeting.agenda_locked_level)}</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleControlAction('lock-agenda', 'Main Agenda locked for lower levels.')}
                        disabled={!access.canLockAgenda || actionLoading === 'lock-agenda'}
                        className="w-full text-left px-3 py-2 bg-muted hover:bg-muted/80 text-foreground border border-border rounded-md text-xs font-medium transition-colors disabled:opacity-40 flex items-center justify-between"
                      >
                        <span className="flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> Lock Main Agenda</span>
                      </button>
                    )}

                    {/* 3. Lock / Unlock Supplementary Agenda */}
                    {meeting.suppli_agenda_locked_level !== null ? (
                      <button
                        onClick={() => handleControlAction('unlock-suppli-agenda', 'Supplementary Agenda unlocked.')}
                        disabled={!canUnlockItem(user, meeting.suppli_agenda_locked_level) || actionLoading === 'unlock-suppli-agenda'}
                        className="w-full text-left px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-900 dark:text-emerald-200 border border-emerald-500/30 rounded-md text-xs font-medium transition-colors disabled:opacity-40 flex items-center justify-between"
                      >
                        <span className="flex items-center gap-1.5"><Unlock className="w-3.5 h-3.5" /> Unlock Suppli Agenda</span>
                        <span className="text-[10px] bg-emerald-500/20 px-1.5 py-0.5 rounded font-bold">Locked by {getLevelTitle(meeting.suppli_agenda_locked_level)}</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleControlAction('lock-suppli-agenda', 'Supplementary Agenda locked for lower levels.')}
                        disabled={!access.canLockSuppliAgenda || actionLoading === 'lock-suppli-agenda'}
                        className="w-full text-left px-3 py-2 bg-muted hover:bg-muted/80 text-foreground border border-border rounded-md text-xs font-medium transition-colors disabled:opacity-40 flex items-center justify-between"
                      >
                        <span className="flex items-center gap-1.5"><Layers className="w-3.5 h-3.5" /> Lock Suppli Agenda</span>
                      </button>
                    )}

                    {/* 4. Lock / Unlock Resolution */}
                    {meeting.resolution_locked_level !== null ? (
                      <button
                        onClick={() => handleControlAction('unlock-resolution', 'Resolution unlocked.')}
                        disabled={!canUnlockItem(user, meeting.resolution_locked_level) || actionLoading === 'unlock-resolution'}
                        className="w-full text-left px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-900 dark:text-emerald-200 border border-emerald-500/30 rounded-md text-xs font-medium transition-colors disabled:opacity-40 flex items-center justify-between"
                      >
                        <span className="flex items-center gap-1.5"><Unlock className="w-3.5 h-3.5" /> Unlock Resolution</span>
                        <span className="text-[10px] bg-emerald-500/20 px-1.5 py-0.5 rounded font-bold">Locked by {getLevelTitle(meeting.resolution_locked_level)}</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleControlAction('lock-resolution', 'Resolution locked for lower levels.')}
                        disabled={!access.canLockResolution || actionLoading === 'lock-resolution'}
                        className="w-full text-left px-3 py-2 bg-muted hover:bg-muted/80 text-foreground border border-border rounded-md text-xs font-medium transition-colors disabled:opacity-40 flex items-center justify-between"
                      >
                        <span className="flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> Lock Resolution</span>
                      </button>
                    )}

                    {/* 5. Lock / Unlock Resolution Status */}
                    {meeting.resolution_status_locked_level !== null ? (
                      <button
                        onClick={() => handleControlAction('unlock-resolution-status', 'Resolution Status unlocked.')}
                        disabled={!canUnlockItem(user, meeting.resolution_status_locked_level) || actionLoading === 'unlock-resolution-status'}
                        className="w-full text-left px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-900 dark:text-emerald-200 border border-emerald-500/30 rounded-md text-xs font-medium transition-colors disabled:opacity-40 flex items-center justify-between"
                      >
                        <span className="flex items-center gap-1.5"><Unlock className="w-3.5 h-3.5" /> Unlock Resolution Status</span>
                        <span className="text-[10px] bg-emerald-500/20 px-1.5 py-0.5 rounded font-bold">Locked by {getLevelTitle(meeting.resolution_status_locked_level)}</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleControlAction('lock-resolution-status', 'Resolution Status locked for lower levels.')}
                        disabled={!access.canLockResolutionStatus || actionLoading === 'lock-resolution-status'}
                        className="w-full text-left px-3 py-2 bg-muted hover:bg-muted/80 text-foreground border border-border rounded-md text-xs font-medium transition-colors disabled:opacity-40 flex items-center justify-between"
                      >
                        <span className="flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> Lock Resolution Status</span>
                      </button>
                    )}

                    {/* 6. Lock / Unlock Invitees */}
                    {meeting.invitees_locked_level !== null ? (
                      <button
                        onClick={() => handleControlAction('unlock-invitees', 'Invitees unlocked.')}
                        disabled={!canUnlockItem(user, meeting.invitees_locked_level) || actionLoading === 'unlock-invitees'}
                        className="w-full text-left px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-900 dark:text-emerald-200 border border-emerald-500/30 rounded-md text-xs font-medium transition-colors disabled:opacity-40 flex items-center justify-between"
                      >
                        <span className="flex items-center gap-1.5"><Unlock className="w-3.5 h-3.5" /> Unlock Invitees</span>
                        <span className="text-[10px] bg-emerald-500/20 px-1.5 py-0.5 rounded font-bold">Locked by {getLevelTitle(meeting.invitees_locked_level)}</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleControlAction('lock-invitees', 'Invitees locked for lower levels.')}
                        disabled={!access.canLockInvitees || actionLoading === 'lock-invitees'}
                        className="w-full text-left px-3 py-2 bg-muted hover:bg-muted/80 text-foreground border border-border rounded-md text-xs font-medium transition-colors disabled:opacity-40 flex items-center justify-between"
                      >
                        <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Lock Invitees</span>
                      </button>
                    )}

                    {/* 7. Lock / Unlock Presentees */}
                    {meeting.presentees_locked_level !== null ? (
                      <button
                        onClick={() => handleControlAction('unlock-presentees', 'Presentees unlocked.')}
                        disabled={!canUnlockItem(user, meeting.presentees_locked_level) || actionLoading === 'unlock-presentees'}
                        className="w-full text-left px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-900 dark:text-emerald-200 border border-emerald-500/30 rounded-md text-xs font-medium transition-colors disabled:opacity-40 flex items-center justify-between"
                      >
                        <span className="flex items-center gap-1.5"><Unlock className="w-3.5 h-3.5" /> Unlock Presentees</span>
                        <span className="text-[10px] bg-emerald-500/20 px-1.5 py-0.5 rounded font-bold">Locked by {getLevelTitle(meeting.presentees_locked_level)}</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleControlAction('lock-presentees', 'Presentees locked for lower levels.')}
                        disabled={!access.canLockPresentees || actionLoading === 'lock-presentees'}
                        className="w-full text-left px-3 py-2 bg-muted hover:bg-muted/80 text-foreground border border-border rounded-md text-xs font-medium transition-colors disabled:opacity-40 flex items-center justify-between"
                      >
                        <span className="flex items-center gap-1.5"><UserCheck className="w-3.5 h-3.5" /> Lock Presentees</span>
                      </button>
                    )}

                    {/* 8. Lock / Unlock Conclusion */}
                    {meeting.conclusion_locked_level !== null ? (
                      <button
                        onClick={() => handleControlAction('unlock-conclusion', 'Conclusion unlocked.')}
                        disabled={!canUnlockItem(user, meeting.conclusion_locked_level) || actionLoading === 'unlock-conclusion'}
                        className="w-full text-left px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-900 dark:text-emerald-200 border border-emerald-500/30 rounded-md text-xs font-medium transition-colors disabled:opacity-40 flex items-center justify-between"
                      >
                        <span className="flex items-center gap-1.5"><Unlock className="w-3.5 h-3.5" /> Unlock Conclusion</span>
                        <span className="text-[10px] bg-emerald-500/20 px-1.5 py-0.5 rounded font-bold">Locked by {getLevelTitle(meeting.conclusion_locked_level)}</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleControlAction('lock-conclusion', 'President & Conclusion locked for lower levels.')}
                        disabled={!access.canLockConclusion || actionLoading === 'lock-conclusion'}
                        className="w-full text-left px-3 py-2 bg-muted hover:bg-muted/80 text-foreground border border-border rounded-md text-xs font-medium transition-colors disabled:opacity-40 flex items-center justify-between"
                      >
                        <span className="flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Lock Conclusion</span>
                      </button>
                    )}
                  </div>
                </div>

                <hr className="border-border" />

                {/* Mark Completed Section (Authorized user / Admin) */}
                {canCompleteMeeting(user, meeting) && (
                  <div className="pt-1">
                    <button
                      onClick={() => {
                        setConfirmTitle("");
                        setIsCompleteModalOpen(true);
                      }}
                      className="w-full py-2.5 px-4 bg-primary text-primary-foreground font-semibold hover:bg-primary/90 text-xs rounded-md shadow-sm transition-colors flex items-center justify-center gap-2"
                    >
                      <CheckCircle2 className="w-4 h-4" /> Mark Meeting Completed
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Handover Password Confirmation Modal */}
      {isHandoverModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="bg-card w-full max-w-md rounded-lg shadow-xl border border-border flex flex-col p-6 animate-in zoom-in-95 duration-200 space-y-4">
            <div className="flex items-center gap-3 border-b border-border pb-3">
              <div className="bg-amber-500/10 p-2 rounded-full text-amber-600">
                <KeyRound className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-lg font-bold">Confirm Handover</h2>
                <p className="text-xs text-muted-foreground">Please enter your account password to verify handover to upper levels.</p>
              </div>
            </div>

            <form onSubmit={handleHandoverSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase">
                  Account Password
                </label>
                <input
                  type="password"
                  required
                  autoFocus
                  value={handoverPassword}
                  onChange={(e) => setHandoverPassword(e.target.value)}
                  placeholder="Enter your login password"
                  className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsHandoverModalOpen(false)}
                  disabled={isSubmittingHandover}
                  className="px-4 py-2 text-sm font-medium hover:bg-accent rounded-md transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!handoverPassword || isSubmittingHandover}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-md shadow-sm transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {isSubmittingHandover ? "Verifying..." : "Confirm & Handover"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Completion Confirmation Modal */}
      {isCompleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="bg-card w-full max-w-md rounded-lg shadow-xl border border-border flex flex-col p-6 animate-in zoom-in-95 duration-200 space-y-4">
            <h2 className="text-xl font-bold">Confirm Meeting Completion</h2>
            <p className="text-sm text-muted-foreground">
              This will mark the meeting status as <span className="font-bold text-foreground">Past</span>, freeze member attendance from invitees to presentees, and lock the meeting.
            </p>
            
            <div className="space-y-2">
              <label className="text-sm font-medium text-destructive">
                Type meeting serial number <span className="font-bold">"{formData.title}"</span> for confirmation:
              </label>
              <input 
                type="text" 
                value={confirmTitle}
                onChange={(e) => setConfirmTitle(e.target.value)}
                placeholder="Meeting Serial Number"
                className="w-full px-3 py-2 bg-input/20 border border-destructive/50 rounded-md focus:ring-1 focus:ring-destructive focus:border-destructive text-sm"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button 
                onClick={() => setIsCompleteModalOpen(false)}
                disabled={isCompleting}
                className="px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground rounded-md transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button 
                onClick={handleCompleteMeeting}
                disabled={confirmTitle !== formData.title || isCompleting}
                className="px-4 py-2 bg-destructive text-destructive-foreground hover:bg-destructive/90 text-sm font-medium rounded-md shadow-sm transition-colors disabled:opacity-50"
              >
                {isCompleting ? "Processing..." : "Confirm & Mark Completed"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
