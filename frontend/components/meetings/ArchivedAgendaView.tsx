"use client";

import { useState } from "react";
import useSWR from "swr";
import api, { fetcher } from "../../lib/api";
import { toast } from "sonner";
import { useAuth } from "../../hooks/useAuth";
import { canEditAgenda, canEditSuppliAgenda } from "../../lib/meetingAccess";
import {
  Archive,
  Search,
  PlusCircle,
  Trash2,
  Loader2,
  Calendar,
  FileText,
  CheckSquare,
  Square,
  LayoutList,
  Layers
} from "lucide-react";

export default function ArchivedAgendaView({ meeting }: { meeting: any }) {
  const { user } = useAuth();
  const isEmergencyMeeting = meeting?.is_regular === false;
  const canRestoreToAgenda = canEditAgenda(user, meeting);
  const canRestoreToSuppli = !isEmergencyMeeting && canEditSuppliAgenda(user, meeting);

  const { data: archivedRes, mutate: mutateArchived, isLoading } = useSWR(
    "/agendas/archived",
    fetcher
  );

  const archivedAgendas = archivedRes?.data || [];

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [destination, setDestination] = useState<'agenda' | 'suppli'>(
    canRestoreToAgenda ? 'agenda' : 'suppli'
  );
  const [restoring, setRestoring] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filteredAgendas = archivedAgendas.filter((item: any) => {
    const textContent = (item.content_plain || item.content || "").toLowerCase();
    const meetingInfo = (
      (item.meeting_display_title || item.meeting_title || "") +
      " " +
      (item.meeting_number || "")
    ).toLowerCase();
    const q = searchQuery.toLowerCase();
    return textContent.includes(q) || meetingInfo.includes(q);
  });

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredAgendas.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredAgendas.map((item: any) => item.id));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleRestore = async () => {
    if (selectedIds.length === 0) {
      toast.error("Please select at least one archived agenda to restore.");
      return;
    }
    setRestoring(true);
    try {
      await api.post(`/agendas/meeting/${meeting.id}/restore-archived`, {
        agenda_ids: selectedIds,
        is_suppli: destination === 'suppli'
      });
      toast.success(
        `${selectedIds.length} agenda(s) added to ${destination === 'suppli' ? 'Supplementary Agenda' : 'Agenda'} successfully!`
      );
      setSelectedIds([]);
      await mutateArchived();
    } catch (err: any) {
      toast.error(
        err.response?.data?.message || "Failed to restore archived agendas"
      );
    } finally {
      setRestoring(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (
      !confirm(
        "Are you sure you want to permanently delete this archived agenda? This action cannot be undone."
      )
    ) {
      return;
    }
    setDeletingId(id);
    try {
      await api.delete(`/agendas/archived/${id}`);
      toast.success("Archived agenda deleted permanently.");
      setSelectedIds((prev) => prev.filter((item) => item !== id));
      await mutateArchived();
    } catch (err: any) {
      toast.error(
        err.response?.data?.message || "Failed to delete archived agenda"
      );
    } finally {
      setDeletingId(null);
    }
  };

  const stripHtml = (html: string) => {
    if (!html) return "";
    return html.replace(/<[^>]*>?/gm, "").trim();
  };

  if (!canRestoreToAgenda && !canRestoreToSuppli) {
    return (
      <div className="p-8 text-muted-foreground">
        You do not have permission to view or restore archived agendas for this meeting.
      </div>
    );
  }

  return (
    <div className="bg-card border border-border shadow-sm rounded-xl flex flex-col overflow-hidden">
      {/* HEADER */}
      <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/30">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-lg">
            <Archive className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Archived Agenda</h2>
            <p className="text-xs text-muted-foreground">
              Agendas archived from any past meeting. Select items and add them into this meeting's Agenda or Supplementary Agenda.
            </p>
          </div>
        </div>
      </div>

      {/* SEARCH, DESTINATION & BULK CONTROLS */}
      <div className="p-4 border-b border-border bg-card flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by text or meeting title/no..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-input/20 border border-input rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {filteredAgendas.length > 0 && (
            <button
              type="button"
              onClick={toggleSelectAll}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground border border-input rounded-md hover:bg-muted/50 transition-colors"
            >
              {selectedIds.length === filteredAgendas.length ? (
                <CheckSquare className="w-4 h-4 text-primary" />
              ) : (
                <Square className="w-4 h-4" />
              )}
              <span>
                {selectedIds.length === filteredAgendas.length ? "Deselect All" : "Select All"}
              </span>
            </button>
          )}
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3 justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Add selected as:
            <div className="flex items-center gap-1 p-1 bg-muted rounded-lg">
              <button
                type="button"
                disabled={!canRestoreToAgenda}
                onClick={() => setDestination('agenda')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  destination === 'agenda' ? 'bg-primary text-primary-foreground shadow-xs' : 'text-foreground hover:bg-card'
                }`}
              >
                <LayoutList className="w-3.5 h-3.5" />
                Agenda
              </button>
              <button
                type="button"
                disabled={!canRestoreToSuppli}
                onClick={() => setDestination('suppli')}
                title={isEmergencyMeeting ? "Not available for emergency meetings" : undefined}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  destination === 'suppli' ? 'bg-primary text-primary-foreground shadow-xs' : 'text-foreground hover:bg-card'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                Supplementary
              </button>
            </div>
          </div>

          <button
            type="button"
            disabled={selectedIds.length === 0 || restoring}
            onClick={handleRestore}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
          >
            {restoring ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlusCircle className="w-4 h-4" />}
            <span>Add Selected ({selectedIds.length})</span>
          </button>
        </div>
      </div>

      {/* AGENDA ITEMS LIST */}
      <div className="p-6 space-y-3">
        {isLoading ? (
          <div className="py-12 text-center text-muted-foreground flex flex-col items-center gap-2">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <span className="text-sm">Loading archive box items...</span>
          </div>
        ) : filteredAgendas.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground flex flex-col items-center gap-2">
            <Archive className="w-12 h-12 text-muted-foreground/30" />
            <h4 className="text-base font-semibold text-foreground">No Archived Agendas Found</h4>
            <p className="text-xs">
              {searchQuery
                ? "No archived items match your search filter."
                : "Items archived from any meeting will appear here."}
            </p>
          </div>
        ) : (
          filteredAgendas.map((item: any) => {
            const isSelected = selectedIds.includes(item.id);
            const previewText = stripHtml(item.content || "");
            const isItemDeleting = deletingId === item.id;

            return (
              <div
                key={item.id}
                onClick={() => toggleSelect(item.id)}
                className={`p-4 rounded-xl border transition-all cursor-pointer flex gap-4 items-start ${
                  isSelected
                    ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                    : "border-border hover:border-border/80 hover:bg-muted/20"
                }`}
              >
                <div className="pt-0.5">
                  {isSelected ? (
                    <CheckSquare className="w-5 h-5 text-primary" />
                  ) : (
                    <Square className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>

                <div className="flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-muted text-foreground border border-border flex items-center gap-1">
                      <FileText className="w-3 h-3 text-primary" />
                      Archived from: {item.meeting_display_title || item.meeting_title || `Meeting #${item.meeting_number || '?'}`}
                    </span>

                    {item.meeting_number && (
                      <span className="text-xs px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium">
                        No. {item.meeting_number}
                      </span>
                    )}

                    {item.is_suppli && (
                      <span className="text-xs px-2 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 font-medium">
                        Supplementary
                      </span>
                    )}

                    {item.created_at && (
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1 ml-auto">
                        <Calendar className="w-3 h-3" />
                        {new Date(item.created_at).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric"
                        })}
                      </span>
                    )}
                  </div>

                  <p className="text-sm text-foreground line-clamp-3 leading-relaxed font-normal">
                    {previewText || "(Empty content)"}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={isItemDeleting}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(item.id);
                  }}
                  title="Delete permanently from archive"
                  className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors disabled:opacity-50"
                >
                  {isItemDeleting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* FOOTER */}
      <div className="px-6 py-3 border-t border-border bg-muted/20 text-xs text-muted-foreground">
        Total archived items: {archivedAgendas.length}
      </div>
    </div>
  );
}
