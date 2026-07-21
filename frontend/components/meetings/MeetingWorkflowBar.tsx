"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Send, CheckCircle2, CornerDownLeft } from "lucide-react";
import api from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";
import {
  submitTarget,
  canApproveMeeting,
  returnTargets,
  canApproveResolution,
  canReopenResolution,
  STAGE_LABELS,
  STAGE_BADGE_CLASSES,
  type MeetingStage,
  type ReturnTarget,
} from "../../lib/meetingAccess";

const TARGET_LABEL: Record<ReturnTarget, string> = {
  initiator: "Initiator",
  moderator: "Moderator",
};

// Approval-escalation header for a meeting "file": shows the current stage and
// the actions available to the current user — submit up the chain, approve
// (admin/superadmin), or hand back down with a note.
export default function MeetingWorkflowBar({ meeting, onChanged }: { meeting: any; onChanged: () => void }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [returnTo, setReturnTo] = useState<ReturnTarget | null>(null);
  const [note, setNote] = useState("");

  if (!meeting) return null;

  const stage: MeetingStage = (meeting.stage as MeetingStage) || "initiator";
  const nextUp = submitTarget(user, meeting);
  const canApprove = canApproveMeeting(user, meeting);
  const targets = returnTargets(user, meeting);
  const canApproveRes = canApproveResolution(user, meeting);
  const canReopenRes = canReopenResolution(user, meeting);

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

  return (
    <div className="mb-6 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STAGE_BADGE_CLASSES[stage]}`}>
            {STAGE_LABELS[stage]}
          </span>
          {meeting.creator_username && (
            <span className="text-xs text-muted-foreground">
              Initiator: <span className="font-medium text-foreground">{meeting.creator_username}</span>
            </span>
          )}
          {stage === "approved" && meeting.reviewer_username && (
            <span className="text-xs text-muted-foreground">
              Approved by <span className="font-medium text-foreground">{meeting.reviewer_username}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {nextUp && (
            <button
              disabled={busy}
              onClick={() => act("submit", {}, `Submitted to the ${nextUp}`)}
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground text-sm font-medium px-4 py-2 rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              <Send className="w-4 h-4" /> Submit to {nextUp === "moderator" ? "Moderator" : "Admin"}
            </button>
          )}
          {canApprove && (
            <button
              disabled={busy}
              onClick={() => act("approve", {}, "File approved")}
              className="inline-flex items-center gap-2 bg-emerald-600 text-white text-sm font-medium px-4 py-2 rounded-md hover:bg-emerald-700 disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" /> Approve
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

      {/* Resolution / attendance phase, once the agenda is approved. */}
      {stage === "approved" && (
        <div className="mt-3 pt-3 border-t border-border flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Resolution &amp; attendance:</span>
            {meeting.resolution_approved ? (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                Approved — locked
              </span>
            ) : meeting.status === "ongoing" ? (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                Open for editing
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">Set status to &ldquo;Ongoing&rdquo; (Meeting Info) to open</span>
            )}
          </div>
          <div className="flex gap-2">
            {canApproveRes && (
              <button
                disabled={busy}
                onClick={() => act("approve-resolution", {}, "Resolution approved")}
                className="inline-flex items-center gap-2 bg-emerald-600 text-white text-sm font-medium px-4 py-2 rounded-md hover:bg-emerald-700 disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" /> Approve Resolution
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
          </div>
        </div>
      )}

      {/* Note left by whoever last handed the file back. */}
      {meeting.review_note && (stage === "initiator" || stage === "moderator") && (
        <div className="mt-3 rounded-md border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-800 dark:text-red-300">
          <span className="font-semibold">Note:</span> {meeting.review_note}
        </div>
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
              onClick={() => act("return", { target: returnTo, note }, `Sent back to the ${returnTo}`)}
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
