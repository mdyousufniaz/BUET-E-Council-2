"use client";

import { useState } from "react";
import { Edit3, Plus, FileText, GripVertical, Trash2 } from "lucide-react";
import RichTextEditor from "../RichTextEditor";
import AnnexureList from "./AnnexureList";
import RevisionHistory from "./RevisionHistory";
import TagChipSelector from "../TagChipSelector";
import useSWR from "swr";
import api, { fetcher } from "../../lib/api";
import { sanitizeHtml } from "../../lib/sanitize";
import { toast } from "sonner";
import { useConfirm } from "../../hooks/useConfirm";
import { useAuth } from "../../hooks/useAuth";
import { canAuthorMeeting, canOperateMeeting } from "../../lib/meetingAccess";
import { toBanglaDigits } from "../../lib/banglaNumerals";
import TemplateDrawer from "../TemplateDrawer";

export default function AgendaView({ meeting, type }: { meeting: any, type: string }) {
  const { user } = useAuth();
  const canEdit = canAuthorMeeting(user, meeting);
  const canManageAnnexures = canOperateMeeting(user, meeting);
  const isSuppliView = type === 'suppli-agenda';
  const { data: response, mutate } = useSWR(`/agendas?meeting_id=${meeting.id}&is_suppli=${isSuppliView}`, fetcher, { fallbackData: { data: [] } });
  const agendas = response?.data || [];
  const { confirm, ConfirmModal } = useConfirm();

  // Meeting criteria (regular/emergency) is a creation-time-only choice, never
  // persisted to the DB — it's stashed in localStorage by the create-meeting
  // form so this tab can still enforce "emergency meetings get 1 agendum only"
  // without a schema change. Only applies to the main Agenda tab, not Supplementary.
  const isEmergencyMeeting = typeof window !== 'undefined'
    && window.localStorage.getItem(`meeting_criteria_${meeting.id}`) === 'emergency';
  const emergencyLimitReached = !isSuppliView && isEmergencyMeeting && agendas.length >= 1;

  const { data: tagsResponse, mutate: mutateTags } = useSWR('/tags', fetcher, { fallbackData: { data: [] } });
  const allTags = tagsResponse?.data || [];

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editTagIds, setEditTagIds] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [newTagIds, setNewTagIds] = useState<string[]>([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const handleAddNewTag = async (name: string, target: "new" | "edit") => {
    try {
      const res = await api.post('/tags', { name });
      const tag = res.data.data;
      mutateTags();
      if (target === "new") setNewTagIds(prev => [...prev, tag.id]);
      else setEditTagIds(prev => [...prev, tag.id]);
    } catch (err) {
      toast.error("Failed to create tag");
    }
  };

  const title = type === 'suppli-agenda' ? 'Supplementary Agenda' : 'Agenda Items';
  const isLocked = meeting.is_locked;
  const readOnly = isLocked || !canEdit;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await api.put(`/agendas/${editingId}`, { content: editContent, tag_ids: editTagIds });
      mutate();
      setEditingId(null);
      toast.success("Agendum saved successfully");
    } catch (err: any) {
      toast.error("Failed to save agendum");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData("text/plain", id);
  };

  const handleDrop = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData("text/plain");
    if (sourceId === targetId) return;

    // Local optimistic update
    const sourceIndex = agendas.findIndex((a: any) => a.id === sourceId);
    const targetIndex = agendas.findIndex((a: any) => a.id === targetId);
    
    if (sourceIndex < 0 || targetIndex < 0) return;

    const newAgendas = [...agendas];
    const [moved] = newAgendas.splice(sourceIndex, 1);
    newAgendas.splice(targetIndex, 0, moved);
    
    // Update serials based on new position
    const updatedAgendas = newAgendas.map((a: any, idx: number) => ({
      ...a,
      agenda_serial: idx + 1
    }));
    
    // Mutate locally
    mutate({ ...response, data: updatedAgendas }, false);

    // Sync with backend (could be parallelized)
    try {
      await Promise.all(
        updatedAgendas.map((a: any) => 
          api.put(`/agendas/${a.id}`, { agenda_serial: a.agenda_serial })
        )
      );
      mutate(); // Re-fetch to ensure sync
      toast.success("Agendas reordered");
    } catch (err) {
      toast.error("Failed to reorder agendas");
      mutate(); // Revert on failure
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleStartCreate = () => {
    setIsCreating(true);
    setNewContent("");
    setNewTagIds([]);
    setEditingId(null);
  };

  const handleSaveNew = async () => {
    setIsSaving(true);
    const nextSerial = agendas.length > 0 ? Math.max(...agendas.map((a: any) => a.agenda_serial || 0)) + 1 : 1;
    try {
      await api.post(`/agendas`, {
        meeting_id: meeting.id,
        agenda_serial: nextSerial,
        content: newContent,
        is_suppli: isSuppliView,
        tag_ids: newTagIds,
        // Transient flag, re-sent on every create call since it's never stored
        // on the meeting row — lets the backend also enforce the 1-agendum cap.
        meeting_criteria: (!isSuppliView && isEmergencyMeeting) ? 'emergency' : undefined
      });
      mutate();
      setIsCreating(false);
      setNewTagIds([]);
      toast.success("Agendum created");
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to create agendum");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = (id: string) => {
    confirm("Delete Agendum", "Are you sure you want to delete this agendum?", async () => {
      try {
        await api.delete(`/agendas/${id}`);
        mutate();
        toast.success("Agendum deleted");
      } catch (err) {
        toast.error("Failed to delete agendum");
      }
    });
  };

  const handleEditClick = (agenda: any) => {
    setEditingId(agenda.id);
    setEditContent(agenda.content || "");
    setEditTagIds((agenda.tags || []).map((t: any) => t.id));
    setIsCreating(false);
  };

  return (
    <div className="flex gap-8 h-full">
      <ConfirmModal />
      {/* Main Left Area (70%) */}
      <div className="flex-1 w-[70%] max-w-4xl pb-32 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">{title}</h2>
        </div>

        {agendas.length === 0 && !isCreating ? (
          <div className="bg-card border border-border border-dashed rounded-lg p-12 flex flex-col items-center justify-center text-center space-y-4 shadow-sm h-64">
            <div className="bg-muted p-4 rounded-full">
              <FileText className="w-8 h-8 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-primary">No Agendas Found</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">There are currently no agendas for this meeting. Create a new agenda to get started.</p>
            </div>
            {!readOnly && (
              <div className="flex gap-4 mt-4">
                <button
                  onClick={handleStartCreate}
                  className="bg-primary text-primary-foreground py-2 px-6 rounded-md font-medium shadow-sm hover:bg-primary/90 transition-colors flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" /> Create New Agendum
                </button>
                <button
                  onClick={() => setIsDrawerOpen(true)}
                  className="bg-accent text-accent-foreground border border-border py-2 px-6 rounded-md font-medium shadow-sm hover:bg-accent/80 transition-colors flex items-center gap-2"
                >
                  <FileText className="w-4 h-4" /> Create from Template
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {agendas.map((agenda: any, index: number) => (
            <div key={agenda.id}>
              {/* Agenda Card */}
              <div className="bg-card border border-border p-6 rounded-lg relative group shadow-sm hover:shadow-md transition-shadow">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-semibold text-lg text-primary">
                    {agenda.is_suppli ? 'Supplementary Ag-' : 'Ag-'}{agenda.agenda_serial || index + 1}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">প্রস্তাব নং {(meeting.agenda_prefix || '') + toBanglaDigits(agenda.agenda_serial || index + 1)}</p>
                </div>
                <div className="flex gap-2">
                  <RevisionHistory contentId={agenda.id} contentType="agendaItem" onRestored={() => mutate()} canRestore={canEdit} />
                  {!readOnly && (
                    <>
                      <button
                        onClick={() => handleEditClick(agenda)}
                        className="text-primary opacity-0 group-hover:opacity-100 transition-opacity p-1 bg-primary/10 rounded-md hover:bg-primary/20"
                        title="Edit Agendum"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(agenda.id)}
                        className="text-destructive opacity-0 group-hover:opacity-100 transition-opacity p-1 bg-destructive/10 rounded-md hover:bg-destructive/20"
                        title="Delete Agendum"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {agenda.tags && agenda.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-4 -mt-2">
                  {agenda.tags.map((tag: any) => (
                    <span key={tag.id} className="bg-muted text-muted-foreground text-xs font-medium px-2 py-0.5 rounded-full">
                      {tag.name}
                    </span>
                  ))}
                </div>
              )}

              {editingId === agenda.id ? (
                <div className="border border-primary/50 rounded-md overflow-hidden ring-2 ring-primary/20">
                  <RichTextEditor
                    content={editContent}
                    onChange={setEditContent}
                    className="p-4 min-h-[200px]"
                  />
                  <div className="bg-muted p-2 px-3 flex justify-between items-center gap-4 border-t border-border">
                    <div className="flex-1 min-w-0">
                      <TagChipSelector
                        options={allTags}
                        value={editTagIds}
                        onChange={setEditTagIds}
                        onAddNew={(name) => handleAddNewTag(name, "edit")}
                        placeholder="Add tag"
                      />
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => setEditingId(null)} className="px-3 py-1 text-xs text-muted-foreground hover:bg-background rounded-md">Cancel</button>
                      <button onClick={handleSave} disabled={isSaving} className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded-md disabled:opacity-50">
                        {isSaving ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  className="prose prose-sm dark:prose-invert max-w-none text-foreground"
                  dangerouslySetInnerHTML={{ __html: agenda.content ? sanitizeHtml(agenda.content) : "<p class='text-muted-foreground italic'>Empty content...</p>" }}
                />
              )}

              {/* Annexure List placed underneath the agenda content */}
              <AnnexureList contentId={agenda.id} type="agenda" isLocked={isLocked} readOnly={!canManageAnnexures} />
            </div>

            {/* Insertion Strip (UX Magic) */}
            {!isCreating && !readOnly && !emergencyLimitReached && (
              <div className="h-10 my-2 relative group flex items-center justify-center cursor-pointer">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t-2 border-dashed border-primary/30"></div>
                </div>
                <div className="relative flex gap-3">
                  <button onClick={handleStartCreate} className="bg-accent text-accent-foreground border border-border shadow-sm py-1.5 px-4 text-xs font-medium rounded-full flex items-center gap-2 hover:bg-accent/80 transition-colors">
                    <Plus className="w-3 h-3" /> Create Agendum
                  </button>
                  <button onClick={() => setIsDrawerOpen(true)} className="bg-accent text-accent-foreground border border-border shadow-sm py-1.5 px-4 text-xs font-medium rounded-full flex items-center gap-2 hover:bg-accent/80 transition-colors">
                    <FileText className="w-3 h-3" /> From Template
                  </button>
                </div>
              </div>
            )}

            {!isCreating && !readOnly && emergencyLimitReached && (
              <div className="my-2 flex items-center justify-center gap-2 text-xs text-sky-600 dark:text-sky-400 bg-sky-500/10 rounded-full py-1.5 px-4 w-fit mx-auto">
                Emergency meeting — limited to 1 agendum.
              </div>
            )}
          </div>
        ))}

        {/* Create New Agendum Form */}
        {isCreating && !readOnly && (
          <div className="bg-card border border-primary/50 rounded-lg relative group shadow-sm hover:shadow-md transition-shadow mt-4">
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <h3 className="font-semibold text-lg text-primary">
                  New {title}
                </h3>
              </div>
              <div className="border border-primary/50 rounded-md overflow-hidden ring-2 ring-primary/20">
                <RichTextEditor
                  content={newContent}
                  onChange={setNewContent}
                  className="p-4 min-h-[200px]"
                />
                <div className="bg-muted p-3 flex justify-between items-center gap-4 border-t border-border">
                  <div className="flex-1 min-w-0">
                    <TagChipSelector
                      options={allTags}
                      value={newTagIds}
                      onChange={setNewTagIds}
                      onAddNew={(name) => handleAddNewTag(name, "new")}
                      placeholder="Add tag"
                    />
                  </div>
                  <div className="flex gap-3 shrink-0">
                    <button onClick={() => setIsCreating(false)} className="px-4 py-1.5 text-sm font-medium text-muted-foreground hover:bg-background rounded-md transition-colors">Cancel</button>
                    <button onClick={handleSaveNew} disabled={isSaving || !newContent} className="px-4 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-md disabled:opacity-50 transition-opacity">
                      {isSaving ? "Saving..." : "Create Agendum"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        </>
      )}
      </div>

      {/* Right Sticky Panel (Reordering) - 30% */}
      <div className="w-[30%] shrink-0">
        <div className="bg-sidebar/50 border border-border rounded-lg p-5 sticky top-8 max-h-[80vh] overflow-y-auto shadow-sm backdrop-blur-sm">
          <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground mb-4">Reorder Sequence</h3>
          
          <div className="space-y-2">
            {agendas.map((agenda: any, index: number) => (
              <div 
                key={agenda.id} 
                draggable={!readOnly}
                onDragStart={(e) => !readOnly && handleDragStart(e, agenda.id)}
                onDragOver={!readOnly ? handleDragOver : undefined}
                onDrop={(e) => !readOnly && handleDrop(e, agenda.id)}
                className={`bg-card border border-border p-3 rounded-md flex items-center gap-3 transition-colors group shadow-sm ${!readOnly ? 'cursor-grab hover:border-primary/50 active:cursor-grabbing' : ''}`}
              >
                <GripVertical className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                <span className="font-medium text-sm">
                  {agenda.is_suppli ? 'Supplementary Ag-' : 'Ag-'}{agenda.agenda_serial || index + 1}
                </span>
                <span className="text-xs text-muted-foreground truncate flex-1 opacity-60">
                  {agenda.content ? agenda.content.replace(/<[^>]*>?/gm, '').substring(0, 20) : '...'}...
                </span>
              </div>
            ))}
          </div>
          
          <p className="text-xs text-muted-foreground mt-6 text-center italic">
            Drag and drop items to reorder the sequence in real-time.
          </p>
        </div>
      </div>

      <TemplateDrawer 
        isOpen={isDrawerOpen} 
        onClose={() => setIsDrawerOpen(false)} 
        type="agendam"
        onSelect={(templateContent) => {
          if (editingId) {
            setEditContent(prev => prev + (prev ? '<br/>' : '') + templateContent);
          } else {
            setNewContent(prev => prev + (prev ? '<br/>' : '') + templateContent);
            if (!isCreating) {
              setIsCreating(true);
            }
          }
        }}
      />
    </div>
  );
}
