"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { fetcher } from "../../lib/api";
import {
  Mail,
  Bell,
  FileText,
  CheckCircle2,
  Lock,
  Plus,
  FolderOpen,
} from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { canEditEmail } from "../../lib/meetingAccess";
import SendAgendaModal, { type EmailMode } from "./SendAgendaModal";
import NoticeView from "./NoticeView";

interface EmailTabViewProps {
  meeting: any;
  mutate: any;
}

export default function EmailTabView({ meeting, mutate }: EmailTabViewProps) {
  const params = useParams();
  const { user } = useAuth();
  const isEmailEditable = canEditEmail(user, meeting);
  const canSendEmail = isEmailEditable;
  const isPast = meeting.status === "past";
  const isOngoing = meeting.status === "ongoing";
  const isDraft = meeting.status === "draft";
  const isCompleted = meeting.is_completed === true;

  const [activeTab, setActiveTab] = useState<"email" | "document">("email");
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [emailModalMode, setEmailModalMode] = useState<EmailMode>("custom");
  const [activeDraft, setActiveDraft] = useState<any>(null);
  const [draftKey, setDraftKey] = useState(0);
  const currentUserEmail = user?.email || "admin@buet.ac.bd";

  const { data: inviteesRes, isLoading } = useSWR(
    `/meetings/${meeting.id}/invitees`,
    fetcher,
    { fallbackData: { data: [] } }
  );
  const invitees = inviteesRes?.data || [];
  const inviteesWithEmail = invitees.filter((i: any) => !!i.email);

  const noticeSentCount = inviteesWithEmail.filter((i: any) => i.notice_mail_sent).length;
  const agendaSentCount = inviteesWithEmail.filter((i: any) => i.agenda_mail_sent).length;
  const resolutionSentCount = inviteesWithEmail.filter((i: any) => i.resolution_mail_sent).length;
  const allNoticeSent = inviteesWithEmail.length > 0 && inviteesWithEmail.every((i: any) => i.notice_mail_sent);
  const allAgendaSent = inviteesWithEmail.length > 0 && inviteesWithEmail.every((i: any) => i.agenda_mail_sent);
  const allResolutionSent = inviteesWithEmail.length > 0 && inviteesWithEmail.every((i: any) => i.resolution_mail_sent);

  const { data: draftsRes, mutate: mutateDrafts } = useSWR(
    canSendEmail ? `/meetings/${meeting.id}/email-drafts` : null,
    fetcher,
    { fallbackData: { data: { notice: null, agenda: null, resolution: null } } }
  );
  const drafts = draftsRes?.data || { notice: null, agenda: null, resolution: null };

  // New: fresh window with prefilled body (as before). Open Draft: import the
  // saved draft exactly as it was (disabled when nothing saved).
  const openNoticeModal = (fromDraft = false) => {
    setEmailModalMode("notice");
    setActiveDraft(fromDraft ? drafts.notice : null);
    setDraftKey((k) => k + 1);
    setIsEmailModalOpen(true);
  };

  const openAgendaModal = (fromDraft = false) => {
    setEmailModalMode("agenda");
    setActiveDraft(fromDraft ? drafts.agenda : null);
    setDraftKey((k) => k + 1);
    setIsEmailModalOpen(true);
  };

  const openResolutionModal = (fromDraft = false) => {
    setEmailModalMode("resolution");
    setActiveDraft(fromDraft ? drafts.resolution : null);
    setDraftKey((k) => k + 1);
    setIsEmailModalOpen(true);
  };

  // Enable/disable rules: notice=draft only, agenda=ongoing only, resolution=completed only
  const noticeDisabled = !canSendEmail || allNoticeSent || !isDraft;
  const agendaDisabled = !canSendEmail || allAgendaSent || !isOngoing;
  const resolutionDisabled = !canSendEmail || allResolutionSent || !(isPast || isCompleted);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <Mail className="w-6 h-6 text-primary" />
          <h2 className="text-2xl font-bold">Email</h2>
        </div>
      </div>

      {!isEmailEditable && (
        <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-900 dark:text-amber-200 text-sm flex items-center gap-3">
          <Lock className="w-5 h-5 shrink-0 text-amber-600" />
          <div>
            <span className="font-semibold">Email functionality is restricted or locked.</span> Your role level is lower than the required minimum email sending level configured in System Settings, or email is locked for this meeting.
          </div>
        </div>
      )}

      {/* Sub-tabs */}
      <div className="flex gap-2 mb-6 border-b border-border pb-2">
        <button
          onClick={() => setActiveTab("email")}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            activeTab === "email"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <Mail className="w-4 h-4 inline mr-2" />
          Email
        </button>
        {canSendEmail && (
          <button
            onClick={() => setActiveTab("document")}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === "document"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <FileText className="w-4 h-4 inline mr-2" />
            Email Document
          </button>
        )}
      </div>

      {/* Tab content */}
      {activeTab === "email" ? (
        // Email Tab Content
        isLoading ? (
          <div className="text-center py-16">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-muted-foreground mt-2">Loading invitees...</p>
          </div>
        ) : inviteesWithEmail.length === 0 ? (
          <div className="text-center py-16 bg-card border border-border rounded-lg shadow-sm">
            <Mail className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-medium text-foreground">No Invitees with Email</h3>
            <p className="text-muted-foreground mt-1">
              Add invitees with email addresses to send notifications.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Send Meeting Notice Card — enabled only when draft */}
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className="bg-primary/10 p-3 rounded-lg">
                      <Bell className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground text-lg">Send Meeting Notice</h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        Notify participants about the upcoming meeting date and time.
                      </p>
                      <div className="flex items-center gap-4 mt-3">
                        <span className="text-sm text-muted-foreground">
                          {noticeSentCount} / {inviteesWithEmail.length} notified
                        </span>
                        {allNoticeSent && (
                          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-sm font-medium">
                            <CheckCircle2 className="w-4 h-4" /> All notified
                          </span>
                        )}
                      </div>
                      {!isDraft && (
                        <p className="text-xs text-muted-foreground mt-2">
                          Notice can only be sent when meeting is in draft status.
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => openNoticeModal(false)}
                      disabled={noticeDisabled}
                      title="New notice email"
                      className="px-4 py-2 text-sm font-medium rounded-md flex items-center gap-2 bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                    >
                      <Plus className="w-4 h-4" />
                      New
                    </button>
                    <button
                      onClick={() => openNoticeModal(true)}
                      disabled={noticeDisabled || !drafts.notice}
                      title={drafts.notice ? "Open saved draft" : "No draft saved"}
                      className="px-4 py-2 text-sm font-medium rounded-md flex items-center gap-2 border border-input bg-background hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                    >
                      <FolderOpen className="w-4 h-4" />
                      Open Draft
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Send Meeting Agenda Card — enabled only when ongoing */}
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className="bg-primary/10 p-3 rounded-lg">
                      <FileText className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground text-lg">Send Meeting Agenda</h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        Send the meeting agenda with PDF attached for participants to review.
                      </p>
                      <div className="flex items-center gap-4 mt-3">
                        <span className="text-sm text-muted-foreground">
                          {agendaSentCount} / {inviteesWithEmail.length} sent
                        </span>
                        {allAgendaSent && (
                          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-sm font-medium">
                            <CheckCircle2 className="w-4 h-4" /> All sent
                          </span>
                        )}
                      </div>
                      {!isOngoing && (
                        <p className="text-xs text-muted-foreground mt-2">
                          Agenda can only be sent when meeting is ongoing.
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => openAgendaModal(false)}
                      disabled={agendaDisabled}
                      title="New agenda email"
                      className="px-4 py-2 text-sm font-medium rounded-md flex items-center gap-2 bg-secondary text-secondary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                    >
                      <Plus className="w-4 h-4" />
                      New
                    </button>
                    <button
                      onClick={() => openAgendaModal(true)}
                      disabled={agendaDisabled || !drafts.agenda}
                      title={drafts.agenda ? "Open saved draft" : "No draft saved"}
                      className="px-4 py-2 text-sm font-medium rounded-md flex items-center gap-2 border border-input bg-background hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                    >
                      <FolderOpen className="w-4 h-4" />
                      Open Draft
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Send Meeting Resolution Card — enabled only when completed */}
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className="bg-primary/10 p-3 rounded-lg">
                      <FileText className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground text-lg">Send Meeting Resolution</h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        Send the meeting resolution with PDF attached for participants to review.
                      </p>
                      <div className="flex items-center gap-4 mt-3">
                        <span className="text-sm text-muted-foreground">
                          {resolutionSentCount} / {inviteesWithEmail.length} sent
                        </span>
                        {allResolutionSent && (
                          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-sm font-medium">
                            <CheckCircle2 className="w-4 h-4" /> All sent
                          </span>
                        )}
                      </div>
                      {!(isPast || isCompleted) && (
                        <p className="text-xs text-muted-foreground mt-2">
                          Resolution can only be sent when meeting is completed.
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => openResolutionModal(false)}
                      disabled={resolutionDisabled}
                      title="New resolution email"
                      className="px-4 py-2 text-sm font-medium rounded-md flex items-center gap-2 bg-secondary text-secondary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                    >
                      <Plus className="w-4 h-4" />
                      New
                    </button>
                    <button
                      onClick={() => openResolutionModal(true)}
                      disabled={resolutionDisabled || !drafts.resolution}
                      title={drafts.resolution ? "Open saved draft" : "No draft saved"}
                      className="px-4 py-2 text-sm font-medium rounded-md flex items-center gap-2 border border-input bg-background hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                    >
                      <FolderOpen className="w-4 h-4" />
                      Open Draft
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      ) : (
        // Email Document Tab Content
        <NoticeView meeting={meeting} mutate={mutate} />
      )}

      {/* Info about invitees without email */}
      {activeTab === "email" && inviteesWithEmail.length === 0 && invitees.length > 0 && (
        <p className="text-xs text-muted-foreground mt-4 text-center">
          {invitees.length - inviteesWithEmail.length} invitee(s) have no email on file.
        </p>
      )}

      {/* Email Modal */}
      <SendAgendaModal
        isOpen={isEmailModalOpen}
        onClose={() => setIsEmailModalOpen(false)}
        meeting={meeting}
        currentUserEmail={currentUserEmail}
        mode={emailModalMode}
        initialDraft={activeDraft}
        draftKey={draftKey}
        onSent={() => mutate()}
        onDraftChange={() => mutateDrafts()}
      />
    </div>
  );
}
