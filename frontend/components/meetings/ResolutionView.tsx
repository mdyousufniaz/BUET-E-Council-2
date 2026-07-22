"use client";

import { useState } from "react";
import { Edit3, FileText, FileCheck, Plus, Trash2 } from "lucide-react";
import RichTextEditor from "../RichTextEditor";
import AnnexureList from "./AnnexureList";
import RevisionHistory from "./RevisionHistory";
import TagMultiSelect from "../TagMultiSelect";
import useSWR from "swr";
import api, { fetcher } from "../../lib/api";
import { sanitizeHtml } from "../../lib/sanitize";
import { toast } from "sonner";
import TemplateDrawer from "../TemplateDrawer";
import { useAuth } from "../../hooks/useAuth";
import { canEditResolution } from "../../lib/meetingAccess";
import { useConfirm } from "../../hooks/useConfirm";

export default function ResolutionView({ meeting }: { meeting: any }) {
  const { user } = useAuth();
  const canEdit = canEditResolution(user, meeting);
  const readOnly = !canEdit;
  const { confirm, ConfirmModal } = useConfirm();
  const { data: response, mutate } = useSWR(`/agendas?meeting_id=${meeting.id}`, fetcher, { fallbackData: { data: [] } });

  // Sort main agendas first, suppli agendas last, then by serial
  const agendas = [...(response?.data || [])].sort((a: any, b: any) => {
    if (a.is_suppli === b.is_suppli) {
      return (a.agenda_serial || 0) - (b.agenda_serial || 0);
    }
    return a.is_suppli ? 1 : -1;
  });

  const { data: tagsResponse, mutate: mutateTags } = useSWR('/tags', fetcher, { fallbackData: { data: [] } });
  const allTags = tagsResponse?.data || [];

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editTagIds, setEditTagIds] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [targetAgendaId, setTargetAgendaId] = useState<string | null>(null);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [executionContent, setExecutionContent] = useState("");
  const [isSavingExecution, setIsSavingExecution] = useState(false);

  const handleAddNewTag = async (name: string) => {
    try {
      const res = await api.post('/tags', { name });
      const tag = res.data.data;
      mutateTags();
      setEditTagIds(prev => [...prev, tag.id]);
    } catch (err) {
      toast.error("Failed to create tag");
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await api.put(`/agendas/resolutions/${editingId}`, { resolution: editContent, tag_ids: editTagIds });
      mutate();
      setEditingId(null);
      toast.success("Resolution saved successfully");
    } catch (err) {
      toast.error("Failed to save resolution");
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditClick = (agenda: any) => {
    setEditingId(agenda.id);
    setEditContent(agenda.resolution || "");
    setEditTagIds((agenda.tags || []).map((t: any) => t.id));
  };

  const handleDelete = (agendaId: string) => {
    confirm("Delete Resolution", "Are you sure you want to delete this resolution?", async () => {
      try {
        await api.delete(`/agendas/resolutions/${agendaId}`);
        mutate();
        toast.success("Resolution deleted");
      } catch (err) {
        toast.error("Failed to delete resolution");
      }
    });
  };

  const handleToggleExecuted = async (agenda: any) => {
    try {
      await api.put(`/agendas/resolutions/${agenda.id}/execution`, {
        is_executed: !agenda.is_executed,
        execution_status: agenda.execution_status || ""
      });
      mutate();
      toast.success("Execution status updated");
    } catch (err) {
      toast.error("Failed to update execution status");
    }
  };

  const handleSaveExecution = async (agendaId: string) => {
    setIsSavingExecution(true);
    try {
      await api.put(`/agendas/resolutions/${agendaId}/execution`, {
        is_executed: true,
        execution_status: executionContent
      });
      mutate();
      setExecutingId(null);
      toast.success("Execution details saved");
    } catch (err) {
      toast.error("Failed to save execution details");
    } finally {
      setIsSavingExecution(false);
    }
  };

  return (
    <div className="max-w-4xl pb-32 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <ConfirmModal />
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Resolutions</h2>
      </div>

      {agendas.length === 0 ? (
        <div className="bg-card border border-border border-dashed rounded-lg p-12 flex flex-col items-center justify-center text-center space-y-4 shadow-sm h-64">
          <div className="bg-muted p-4 rounded-full">
            <FileText className="w-8 h-8 text-muted-foreground" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-primary">No Agendas Found</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">There are no agendas to add resolutions for. Please create an agenda first.</p>
          </div>
        </div>
      ) : (
        agendas.map((agenda: any, index: number) => (
          <div key={agenda.id} className="bg-card border border-border rounded-lg p-6 mb-8 shadow-sm group">

            {/* Top Section (Read-Only Agenda) */}
            <div className="mb-6">
              <h3 className="font-semibold text-sm text-primary uppercase tracking-wider mb-2">
                {agenda.is_suppli ? 'Suppli Ag-' : 'Ag-'}{agenda.agenda_serial || index + 1}
              </h3>
              {agenda.tags && agenda.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {agenda.tags.map((tag: any) => (
                    <span key={tag.id} className="bg-muted text-muted-foreground text-xs font-medium px-2 py-0.5 rounded-full">
                      {tag.name}
                    </span>
                  ))}
                </div>
              )}
              <div className="text-muted-foreground bg-muted/30 p-4 rounded-md border-l-4 border-muted/50 prose prose-sm dark:prose-invert max-w-none">
                <div dangerouslySetInnerHTML={{ __html: agenda.content ? sanitizeHtml(agenda.content) : "<p class='italic opacity-50'>Empty agenda...</p>" }} />
              </div>

              {/* Agenda Annexures (Read-Only) */}
              <div className="border-border/50 pt-2">
                <AnnexureList contentId={agenda.id} type="agenda" readOnly={true} />
              </div>
            </div>

            {/* Bottom Section (The Resolution) */}
            <div>
              <h4 className="font-semibold text-sm text-foreground uppercase tracking-wider mb-3 flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <FileCheck className="w-4 h-4 text-primary" />
                  Resolution Outcome
                </span>
                {agenda.resolution && (
                  <div className="flex gap-2">
                    <RevisionHistory contentId={agenda.id} contentType="resolutionItem" onRestored={() => mutate()} canRestore={canEdit} />
                    {!readOnly && (
                      <>
                        <button
                          onClick={() => handleEditClick(agenda)}
                          className="text-primary opacity-0 group-hover:opacity-100 transition-opacity p-1 bg-primary/10 rounded-md hover:bg-primary/20"
                          title="Edit Resolution"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(agenda.id)}
                          className="text-destructive opacity-0 group-hover:opacity-100 transition-opacity p-1 bg-destructive/10 rounded-md hover:bg-destructive/20"
                          title="Delete Resolution"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </h4>

              {editingId === agenda.id ? (
                <div className="border border-primary/50 rounded-md overflow-hidden ring-4 ring-primary/10">
                  <div className="p-3 border-b border-border bg-muted/30">
                    <TagMultiSelect
                      options={allTags}
                      value={editTagIds}
                      onChange={setEditTagIds}
                      onAddNew={handleAddNewTag}
                      placeholder="Add tags..."
                    />
                  </div>
                  <RichTextEditor
                    content={editContent}
                    onChange={setEditContent}
                    className="p-4 min-h-[150px]"
                  />
                  <div className="bg-muted p-2 flex justify-between items-center border-t border-border">
                    <button
                      onClick={() => { setTargetAgendaId(agenda.id); setIsDrawerOpen(true); }}
                      className="px-3 py-1 text-xs text-primary font-medium hover:bg-primary/10 rounded-md flex items-center gap-1.5 transition-colors"
                    >
                      <FileText className="w-3.5 h-3.5" /> From Template
                    </button>
                    <div className="flex gap-2">
                      <button onClick={() => setEditingId(null)} className="px-3 py-1 text-xs text-muted-foreground hover:bg-background rounded-md">Cancel</button>
                      <button onClick={handleSave} disabled={isSaving} className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded-md disabled:opacity-50">
                        {isSaving ? "Saving..." : "Save Resolution"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : agenda.resolution ? (
                <div
                  className="prose prose-sm dark:prose-invert max-w-none text-foreground bg-background border border-border p-5 rounded-md shadow-inner"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(agenda.resolution) }}
                />
              ) : (
                !readOnly && (
                  <div className="flex gap-3">
                    <button
                      onClick={() => handleEditClick(agenda)}
                      className="bg-background border border-primary text-primary hover:bg-primary/5 shadow-sm py-2 px-4 text-sm font-medium rounded-md flex items-center gap-2 transition-colors"
                    >
                      <Edit3 className="w-4 h-4" /> Create Resolution
                    </button>
                    <button
                      onClick={() => {
                        handleEditClick(agenda);
                        setTargetAgendaId(agenda.id);
                        setIsDrawerOpen(true);
                      }}
                      className="bg-accent text-accent-foreground border border-border shadow-sm py-2 px-4 text-sm font-medium rounded-md flex items-center gap-2 hover:bg-accent/80 transition-colors"
                    >
                      <FileText className="w-4 h-4" /> From Template
                    </button>
                  </div>
                )
              )}
            </div>

            {/* Annexure List placed underneath the resolution content */}
            {agenda.resolution && (
              <AnnexureList contentId={agenda.id} type="resolution" readOnly={!canEdit} />
            )}

            {/* Execution Status (Only for past meetings) */}
            {meeting.status === 'past' && agenda.resolution && (
              <div className="mt-8 pt-6 border-t border-border/50">
                <h4 className="font-semibold text-sm text-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
                  <FileCheck className="w-4 h-4 text-emerald-500" />
                  Execution Status
                </h4>

                <div className="flex items-center gap-3 mb-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={readOnly}
                      className="w-4 h-4 rounded border-input text-emerald-600 focus:ring-emerald-500 disabled:opacity-50"
                      checked={agenda.is_executed || false}
                      onChange={() => handleToggleExecuted(agenda)}
                    />
                    <span className="text-sm font-medium">Resolution Executed</span>
                  </label>
                </div>

                <div>
                  {executingId === agenda.id ? (
                    <div className="border border-primary/50 rounded-md overflow-hidden ring-4 ring-primary/10 mb-4">
                      <RichTextEditor
                        content={executionContent}
                        onChange={setExecutionContent}
                        className="p-4 min-h-[100px]"
                      />
                      <div className="bg-muted p-2 flex justify-end gap-2 border-t border-border">
                        <button onClick={() => setExecutingId(null)} className="px-3 py-1 text-xs text-muted-foreground hover:bg-background rounded-md">Cancel</button>
                        <button onClick={() => handleSaveExecution(agenda.id)} disabled={isSavingExecution} className="px-3 py-1 text-xs bg-emerald-600 text-white hover:bg-emerald-700 rounded-md disabled:opacity-50 transition-colors">
                          {isSavingExecution ? "Saving..." : "Save Details"}
                        </button>
                      </div>
                    </div>
                  ) : agenda.execution_status ? (
                    <div className="relative group mb-4">
                      {!readOnly && (
                        <button
                          onClick={() => { setExecutingId(agenda.id); setExecutionContent(agenda.execution_status); }}
                          className="absolute top-0 right-0 text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 bg-emerald-50 rounded-md hover:bg-emerald-100 flex items-center gap-2 text-xs font-medium z-10"
                        >
                          <Edit3 className="w-3.5 h-3.5" /> Edit Details
                        </button>
                      )}
                      <div
                        className="prose prose-sm dark:prose-invert max-w-none text-foreground bg-emerald-200/30 border border-emerald-100 p-4 rounded-md shadow-sm"
                        dangerouslySetInnerHTML={{ __html: sanitizeHtml(agenda.execution_status) }}
                      />
                    </div>
                  ) : (
                    !readOnly && (
                      <button
                        onClick={() => { setExecutingId(agenda.id); setExecutionContent(""); }}
                        className="bg-background border border-emerald-200 text-emerald-700 hover:bg-emerald-50 shadow-sm py-2 px-4 text-sm font-medium rounded-md flex items-center gap-2 transition-colors mb-4"
                      >
                        <Edit3 className="w-4 h-4" /> Add Execution Details
                      </button>
                    )
                  )}
                </div>
              </div>
            )}

          </div>
        )))}

      <TemplateDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        type="resolution"
        onSelect={(templateContent) => {
          if (editingId === targetAgendaId) {
            setEditContent(prev => prev + (prev ? '<br/>' : '') + templateContent);
          } else {
            // Unlikely to hit this branch because we set editingId when opening from "Create" view
            setEditContent(prev => prev + (prev ? '<br/>' : '') + templateContent);
          }
        }}
      />
    </div>
  );
}
