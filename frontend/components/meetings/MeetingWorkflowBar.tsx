"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Send, CheckCircle2, CornerDownLeft, Lock } from "lucide-react";
import api from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";
import {
  submitTarget,
  canApproveMeeting,
  returnTargets,
  resolutionSubmitTarget,
  canApproveResolution,
  canReopenResolution,
  resolutionReturnTargets,
  resolutionPhaseOpen,
  isCompleted,
  badgeStage,
  STAGE_LABELS,
  RESOLUTION_STAGE_LABELS,
  STAGE_BADGE_CLASSES,
  STATUS_LABELS,
  STATUS_BADGE_CLASSES,
  type MeetingStage,
  type MeetingStatus,
  type ReturnTarget,
} from "../../lib/meetingAccess";

const TARGET_LABEL: Record<ReturnTarget, string> = {
  initiator: "Initiator",
  moderator: "Moderator",
};

// Header for a meeting "file". A meeting runs two approval chains one after the
// other — the agenda while it is a draft, then the resolution once the agenda is
// approved — so this renders whichever one is currently live, plus the actions
// available to the viewer within it.
export default function MeetingWorkflowBar({ meeting, onChanged }: { meeting: any; onChanged: () => void }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [returnTo, setReturnTo] = useState<ReturnTarget | null>(null);
  const [note, setNote] = useState("");

  if (!meeting) return null;

  const status: MeetingStatus = (meeting.status as MeetingStatus) || "draft";
  const done = isCompleted(meeting);
  // Once the agenda is approved the resolution chain takes over the controls.
  const inResolutionPhase = resolutionPhaseOpen(meeting);

  const shownAgenda = badgeStage(meeting);
  const resolutionStage: MeetingStage = (meeting.resolution_stage as MeetingStage) || "initiator";

  const nextUp = inResolutionPhase ? resolutionSubmitTarget(user, meeting) : submitTarget(user, meeting);
  const canApprove = inResolutionPhase ? canApproveResolution(user, meeting) : canApproveMeeting(user, meeting);
  const targets = inResolutionPhase ? resolutionReturnTargets(user, meeting) : returnTargets(user, meeting);
  const canReopenRes = canReopenResolution(user, meeting);

  // Endpoint names differ per chain; the button semantics don't.
  const paths = inResolutionPhase
    ? { submit: "submit-resolution", approve: "approve-resolution", return: "return-resolution" }
    : { submit: "submit", approve: "approve", return: "return" };

  const act = async (path: string, body: Record<string, unknown>, successMsg: string) => {
    setBusy(true);
    try {
      await api.post(`/meetings/${meeting.id}/${path}`, body);
      toast.success(successMsg);
      setReturnTo(null);
      setNote("");
      onChanged();
    } catch (e: any) {
      toast.error(e.response?.data?.message || "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const noteBlocks = inResolutionPhase
    ? [
        { key: "rm", by: "moderator", text: meeting.resolution_moderator_note },
        { key: "ra", by: "admin/superadmin", text: meeting.resolution_admin_note },
      ]
    : [
        { key: "m", by: "moderator", text: meeting.moderator_note },
        { key: "a", by: "admin/superadmin", text: meeting.admin_note },
      ];

  return (
    <div className="mb-6 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Meeting status — derived from the workflow, never picked by hand. */}
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_BADGE_CLASSES[status]}`}>
            {STATUS_LABELS[status]}
          </span>
          {/* Whichever chain is live. */}
          {!done && (
            <span
              className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                STAGE_BADGE_CLASSES[inResolutionPhase ? resolutionStage : shownAgenda]
              }`}
            >
              {inResolutionPhase
                ? RESOLUTION_STAGE_LABELS[resolutionStage]
                : STAGE_LABELS[shownAgenda]}
            </span>
          )}
          {meeting.creator_username && (
            <span className="text-xs text-muted-foreground ml-1">
              Initiator: <span className="font-medium text-foreground">{meeting.creator_username}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {nextUp && (
            <button
              disabled={busy}
              onClick={() => act(paths.submit, {}, `Submitted to the ${nextUp}`)}
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground text-sm font-medium px-4 py-2 rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              Send {inResolutionPhase ? "Resolution " : ""}to {nextUp === "moderator" ? "Moderator" : "Admin"}
            </button>
          )}
          {canApprove && (
            <button
              disabled={busy}
              onClick={() =>
                act(
                  paths.approve,
                  {},
                  inResolutionPhase ? "Resolution approved" : "Agenda approved — the meeting is now ongoing",
                )
              }
              className="inline-flex items-center gap-2 bg-emerald-600 text-white text-sm font-medium px-4 py-2 rounded-md hover:bg-emerald-700 disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" /> Approve {inResolutionPhase ? "Resolution" : "Agenda"}
            </button>
          )}
          {canReopenRes && (
            <button
              disabled={busy}
              onClick={() => act("reopen-resolution", {}, "Resolution reopened for editing")}
              className="inline-flex items-center gap-2 border border-border text-sm font-medium px-4 py-2 rounded-md hover:bg-accent disabled:opacity-50"
            >
              <CornerDownLeft className="w-4 h-4" /> Reopen Resolution
            </button>
          )}
          {targets.map((t) => (
            <button
              key={t}
              disabled={busy}
              onClick={() => setReturnTo((cur) => (cur === t ? null : t))}
              className="inline-flex items-center gap-2 bg-destructive text-destructive-foreground text-sm font-medium px-4 py-2 rounded-md hover:opacity-90 disabled:opacity-50"
            >
              <CornerDownLeft className="w-4 h-4" /> Send back to {TARGET_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      {/* A completed meeting is closed to everyone but a superadmin. */}
      {done && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Lock className="w-4 h-4 shrink-0" />
          This meeting has been marked completed and is locked. Only a superadmin can still make changes.
        </div>
      )}

      {/* Explains why the agenda went read-only, for whoever still holds the file. */}
      {!done && inResolutionPhase && (
        <div className="mt-3 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          The agenda is approved and locked. Work now happens on the resolution — send the file back down the chain to reopen the agenda.
        </div>
      )}

      {/* Send-back notes, labeled by who handed the file back. Both show if both left one. */}
      {noteBlocks.map(
        (b) =>
          b.text && (
            <div
              key={b.key}
              className="mt-3 rounded-md border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-800 dark:text-red-300"
            >
              <span className="font-semibold">Sent back by {b.by}:</span> {b.text}
            </div>
          ),
      )}

      {/* Return-note composer. */}
      {returnTo && (
        <div className="mt-3 space-y-2">
          <label className="text-xs font-medium text-muted-foreground">
            Note for the {TARGET_LABEL[returnTo].toLowerCase()} (optional)
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Explain what needs to be fixed..."
            className="w-full px-3 py-2 bg-input/20 border border-input rounded-md text-sm focus:ring-1 focus:ring-ring"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setReturnTo(null);
                setNote("");
              }}
              className="px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent rounded-md"
            >
              Cancel
            </button>
            <button
              disabled={busy}
              onClick={() => act(paths.return, { target: returnTo, note }, `Sent back to the ${returnTo}`)}
              className="px-3 py-1.5 text-sm bg-destructive text-destructive-foreground rounded-md disabled:opacity-50"
            >
              Confirm send back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
