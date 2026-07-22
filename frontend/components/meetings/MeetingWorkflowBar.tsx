"use client";

import useSWR from "swr";
import { fetcher } from "../../lib/api";
import { CheckCircle2, Lock, ArrowRightLeft, Calendar } from "lucide-react";

export default function MeetingWorkflowBar({ meeting, onChanged }: { meeting: any; onChanged: () => void }) {
  const { data: rolesRes } = useSWR('/auth/roles', fetcher);
  const allRoles: any[] = rolesRes?.data || [];

  if (!meeting) return null;

  const isCompleted = meeting.is_completed === true || meeting.status === 'past';

  const getTitle = (lvl: number | null | undefined) => {
    if (lvl === null || lvl === undefined) return null;
    const r = allRoles.find((role: any) => Number(role.level) === Number(lvl));
    return r ? r.level_title : `Level ${lvl}`;
  };

  return (
    <div className="mb-6 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 font-bold text-lg">
            <Calendar className="w-5 h-5 text-primary" />
            <span>{meeting.title}</span>
            {meeting.meeting_title && (
              <span className="text-muted-foreground text-sm font-normal">
                ({meeting.meeting_title})
              </span>
            )}
          </div>

          {/* Status & Level Badges */}
          {isCompleted ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
              <CheckCircle2 className="w-3.5 h-3.5" /> Completed (Past)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 capitalize">
              {meeting.status || 'Active'} Meeting
            </span>
          )}

          {meeting.agenda_handover_level !== null && meeting.agenda_handover_level !== undefined && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
              <ArrowRightLeft className="w-3 h-3" /> Agenda Handed Over ({getTitle(meeting.agenda_handover_level)})
            </span>
          )}

          {meeting.suppli_agenda_handover_level !== null && meeting.suppli_agenda_handover_level !== undefined && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
              <ArrowRightLeft className="w-3 h-3" /> Suppli Agenda Handed Over ({getTitle(meeting.suppli_agenda_handover_level)})
            </span>
          )}

          {meeting.resolution_handover_level !== null && meeting.resolution_handover_level !== undefined && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
              <ArrowRightLeft className="w-3 h-3" /> Resolution Handed Over ({getTitle(meeting.resolution_handover_level)})
            </span>
          )}

          {meeting.resolution_status_handover_level !== null && meeting.resolution_status_handover_level !== undefined && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
              <ArrowRightLeft className="w-3 h-3" /> Resolution Status Handed Over ({getTitle(meeting.resolution_status_handover_level)})
            </span>
          )}

          {meeting.agenda_locked_level !== null && meeting.agenda_locked_level !== undefined && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300">
              <Lock className="w-3 h-3" /> Agenda Locked ({getTitle(meeting.agenda_locked_level)})
            </span>
          )}

          {meeting.suppli_agenda_locked_level !== null && meeting.suppli_agenda_locked_level !== undefined && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300">
              <Lock className="w-3 h-3" /> Suppli Agenda Locked ({getTitle(meeting.suppli_agenda_locked_level)})
            </span>
          )}

          {meeting.resolution_locked_level !== null && meeting.resolution_locked_level !== undefined && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300">
              <Lock className="w-3 h-3" /> Resolution Locked ({getTitle(meeting.resolution_locked_level)})
            </span>
          )}

          {meeting.resolution_status_locked_level !== null && meeting.resolution_status_locked_level !== undefined && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300">
              <Lock className="w-3 h-3" /> Resolution Status Locked ({getTitle(meeting.resolution_status_locked_level)})
            </span>
          )}
        </div>

        {meeting.creator_username && (
          <span className="text-xs text-muted-foreground">
            Created by: <span className="font-semibold text-foreground">{meeting.creator_username}</span>
          </span>
        )}
      </div>
    </div>
  );
}
