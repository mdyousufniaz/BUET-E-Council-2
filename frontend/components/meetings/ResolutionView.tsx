"use client";

import { useState } from "react";
import { Edit3, FileText, FileCheck, Plus } from "lucide-react";
import RichTextEditor from "../RichTextEditor";
import AnnexureList from "./AnnexureList";
import useSWR from "swr";
import api, { fetcher } from "../../lib/api";
import { toast } from "sonner";

export default function ResolutionView({ meeting }: { meeting: any }) {
  const { data: response, mutate } = useSWR(`/agendas?meeting_id=${meeting.id}`, fetcher, { fallbackData: { data: [] } });
  const agendas = response?.data || [];

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await api.put(`/agendas/resolutions/${editingId}`, { resolution: editContent });
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
  };

  return (
    <div className="max-w-4xl pb-32 animate-in fade-in slide-in-from-bottom-4 duration-500">
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
          <div key={agenda.id} className="bg-card border border-border rounded-lg p-6 mb-8 shadow-sm">
          
          {/* Top Section (Read-Only Agenda) */}
          <div className="mb-6">
            <h3 className="font-semibold text-sm text-primary uppercase tracking-wider mb-2">Ag-{agenda.agenda_serial || index + 1}</h3>
            <div className="text-muted-foreground bg-muted/30 p-4 rounded-md border-l-4 border-muted/50 prose prose-sm dark:prose-invert max-w-none">
              <div dangerouslySetInnerHTML={{ __html: agenda.content || "<p class='italic opacity-50'>Empty agenda...</p>" }} />
            </div>
          </div>

          {/* Bottom Section (The Resolution) */}
          <div>
            <h4 className="font-semibold text-sm text-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
              <FileCheck className="w-4 h-4 text-primary" />
              Resolution Outcome
            </h4>

            {editingId === agenda.id ? (
              <div className="border border-primary/50 rounded-md overflow-hidden ring-4 ring-primary/10">
                <RichTextEditor 
                  content={editContent}
                  onChange={setEditContent}
                  className="p-4 min-h-[150px]"
                />
                <div className="bg-muted p-2 flex justify-end gap-2 border-t border-border">
                  <button onClick={() => setEditingId(null)} className="px-3 py-1 text-xs text-muted-foreground hover:bg-background rounded-md">Cancel</button>
                  <button onClick={handleSave} disabled={isSaving} className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded-md disabled:opacity-50">
                    {isSaving ? "Saving..." : "Save Resolution"}
                  </button>
                </div>
              </div>
            ) : agenda.resolution ? (
              <div className="relative group">
                <button 
                  onClick={() => handleEditClick(agenda)}
                  className="absolute top-0 right-0 text-primary opacity-0 group-hover:opacity-100 transition-opacity p-1.5 bg-primary/10 rounded-md hover:bg-primary/20 flex items-center gap-2 text-xs font-medium z-10"
                >
                  <Edit3 className="w-3.5 h-3.5" /> Edit
                </button>
                <div 
                  className="prose prose-sm dark:prose-invert max-w-none text-foreground bg-background border border-border p-5 rounded-md shadow-inner"
                  dangerouslySetInnerHTML={{ __html: agenda.resolution }} 
                />
              </div>
            ) : (
              <div className="flex gap-3">
                <button 
                  onClick={() => handleEditClick(agenda)}
                  className="bg-background border border-primary text-primary hover:bg-primary/5 shadow-sm py-2 px-4 text-sm font-medium rounded-md flex items-center gap-2 transition-colors"
                >
                  <Edit3 className="w-4 h-4" /> Create Resolution
                </button>
                <button className="bg-background border border-border text-foreground hover:bg-muted shadow-sm py-2 px-4 text-sm font-medium rounded-md flex items-center gap-2 transition-colors">
                  <FileText className="w-4 h-4" /> From Template
                </button>
              </div>
            )}
          </div>

          {/* Annexure List placed underneath the resolution content */}
          {agenda.resolution && (
            <AnnexureList contentId={agenda.id} type="resolution" />
          )}
          
        </div>
      )))}
    </div>
  );
}
