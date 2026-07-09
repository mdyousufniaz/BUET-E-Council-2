"use client";

import { useState } from "react";
import { Edit3, Plus, FileText, GripVertical, Trash2 } from "lucide-react";
import RichTextEditor from "../RichTextEditor";
import AnnexureList from "./AnnexureList";
import useSWR from "swr";
import api, { fetcher } from "../../lib/api";
import { sanitizeHtml } from "../../lib/sanitize";
import { toast } from "sonner";
import { useConfirm } from "../../hooks/useConfirm";
import { useAuth } from "../../hooks/useAuth";
import TemplateDrawer from "../TemplateDrawer";

export default function AgendaView({ meeting, type }: { meeting: any, type: string }) {
  const { canEdit } = useAuth();
  const isSuppliView = type === 'suppli-agenda';
  const { data: response, mutate } = useSWR(`/agendas?meeting_id=${meeting.id}&is_suppli=${isSuppliView}`, fetcher, { fallbackData: { data: [] } });
  const agendas = response?.data || [];
  const { confirm, ConfirmModal } = useConfirm();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const title = type === 'suppli-agenda' ? 'Supplementary Agenda' : 'Agenda Items';
  const isLocked = meeting.is_locked;
  const readOnly = isLocked || !canEdit;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await api.put(`/agendas/${editingId}`, { content: editContent });
      mutate();
      setEditingId(null);
      toast.success("Agenda saved successfully");
    } catch (err: any) {
      toast.error("Failed to save agenda");
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
        is_suppli: isSuppliView
      });
      mutate();
      setIsCreating(false);
      toast.success("Agenda created");
    } catch (err: any) {
      toast.error("Failed to create agenda");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = (id: string) => {
    confirm("Delete Agenda", "Are you sure you want to delete this agenda?", async () => {
      try {
        await api.delete(`/agendas/${id}`);
        mutate();
        toast.success("Agenda deleted");
      } catch (err) {
        toast.error("Failed to delete agenda");
      }
    });
  };

  const handleEditClick = (agenda: any) => {
    setEditingId(agenda.id);
    setEditContent(agenda.content || "");
    setIsCreating(false);
  };

  return (
    <div className="flex gap-8 h-full animate-in fade-in slide-in-from-bottom-4 duration-500">
      <ConfirmModal />
      {/* Main Left Area (70%) */}
      <div className="flex-1 w-[70%] max-w-4xl pb-32">
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
                  <Plus className="w-4 h-4" /> Create New Agenda
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
                <h3 className="font-semibold text-lg text-primary">
                  {agenda.is_suppli ? 'Suppli Ag-' : 'Ag-'}{agenda.agenda_serial || index + 1}
                </h3>
                {!readOnly && (
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handleEditClick(agenda)}
                      className="text-primary opacity-0 group-hover:opacity-100 transition-opacity p-1 bg-primary/10 rounded-md hover:bg-primary/20"
                      title="Edit Agenda"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => handleDelete(agenda.id)}
                      className="text-destructive opacity-0 group-hover:opacity-100 transition-opacity p-1 bg-destructive/10 rounded-md hover:bg-destructive/20"
                      title="Delete Agenda"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
              
              {editingId === agenda.id ? (
                <div className="border border-primary/50 rounded-md overflow-hidden ring-2 ring-primary/20">
                  <RichTextEditor 
                    content={editContent}
                    onChange={setEditContent}
                    className="p-4 min-h-[200px]"
                  />
                  <div className="bg-muted p-2 flex justify-end gap-2 border-t border-border">
                    <button onClick={() => setEditingId(null)} className="px-3 py-1 text-xs text-muted-foreground hover:bg-background rounded-md">Cancel</button>
                    <button onClick={handleSave} disabled={isSaving} className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded-md disabled:opacity-50">
                      {isSaving ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              ) : (
                <div 
                  className="prose prose-sm dark:prose-invert max-w-none text-foreground"
                  dangerouslySetInnerHTML={{ __html: agenda.content ? sanitizeHtml(agenda.content) : "<p class='text-muted-foreground italic'>Empty content...</p>" }}
                />
              )}

              {/* Annexure List placed underneath the agenda content */}
              <AnnexureList contentId={agenda.id} type="agenda" isLocked={isLocked} readOnly={!canEdit} />
            </div>

            {/* Insertion Strip (UX Magic) */}
            {!isCreating && !readOnly && (
              <div className="h-10 my-2 relative group flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity cursor-pointer">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t-2 border-dashed border-primary/30"></div>
                </div>
                <div className="relative flex gap-3">
                  <button onClick={handleStartCreate} className="bg-accent text-accent-foreground border border-border shadow-sm py-1.5 px-4 text-xs font-medium rounded-full flex items-center gap-2 hover:bg-accent/80 transition-colors">
                    <Plus className="w-3 h-3" /> Create Agenda
                  </button>
                  <button onClick={() => setIsDrawerOpen(true)} className="bg-accent text-accent-foreground border border-border shadow-sm py-1.5 px-4 text-xs font-medium rounded-full flex items-center gap-2 hover:bg-accent/80 transition-colors">
                    <FileText className="w-3 h-3" /> From Template
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        
        {/* Create New Agenda Form */}
        {isCreating && !readOnly && (
          <div className="bg-card border border-primary/50 rounded-lg relative group shadow-sm hover:shadow-md transition-shadow mt-4">
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <h3 className="font-semibold text-lg text-primary">
                  New {title === 'Supplementary Agenda' ? 'Suppli Agenda' : 'Agenda'}
                </h3>
              </div>
              <div className="border border-primary/50 rounded-md overflow-hidden ring-2 ring-primary/20">
                <RichTextEditor 
                  content={newContent}
                  onChange={setNewContent}
                  className="p-4 min-h-[200px]"
                />
                <div className="bg-muted p-3 flex justify-end gap-3 border-t border-border">
                  <button onClick={() => setIsCreating(false)} className="px-4 py-1.5 text-sm font-medium text-muted-foreground hover:bg-background rounded-md transition-colors">Cancel</button>
                  <button onClick={handleSaveNew} disabled={isSaving || !newContent} className="px-4 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-md disabled:opacity-50 transition-opacity">
                    {isSaving ? "Saving..." : "Create Agenda"}
                  </button>
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
                  {agenda.is_suppli ? 'Suppli Ag-' : 'Ag-'}{agenda.agenda_serial || index + 1}
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
