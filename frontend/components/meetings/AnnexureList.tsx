"use client";

import { useState, useRef } from "react";
import useSWR from "swr";
import api, { fetcher } from "../../lib/api";
import { Paperclip, Trash2, GripVertical, Plus, File, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "../../hooks/useConfirm";

interface Annexure {
  id: string;
  file_name: string;
  url: string | null;
  annexure_serial: number;
  uploaded_by_username?: string | null;
  upload_date?: string | null;
}

interface AnnexureListProps {
  contentId: string;
  type: 'agenda' | 'resolution';
  readOnly?: boolean;
}

export default function AnnexureList({ contentId, type, readOnly = false }: AnnexureListProps) {
  const { data: response, mutate } = useSWR(`/agendas/${contentId}/annexures?type=${type}`, fetcher, { fallbackData: { data: [] } });
  const annexures: Annexure[] = response?.data || [];
  
  const [isUploading, setIsUploading] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { confirm, ConfirmModal } = useConfirm();

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    // Postgres enum requires 'agendaItem' for agendas
    formData.append('annexure_type', type === 'agenda' ? 'agendaItem' : type);

    try {
      await api.post(`/agendas/${contentId}/annexures`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      toast.success("Annexure uploaded successfully");
      mutate();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to upload annexure");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = (id: string) => {
    confirm("Delete Annexure", "Are you sure you want to delete this annexure? This cannot be undone.", async () => {
      try {
        await api.delete(`/agendas/annexures/${id}`);
        toast.success("Annexure deleted successfully");
        mutate();
      } catch (err) {
        toast.error("Failed to delete annexure");
      }
    });
  };

  // Drag and drop sorting handlers
  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
    // Small delay to prevent the dragged item from instantly disappearing from layout
    setTimeout(() => {
      if (e.target instanceof HTMLElement) {
        e.target.style.opacity = '0.5';
      }
    }, 0);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    setDraggedId(null);
    if (e.target instanceof HTMLElement) {
      e.target.style.opacity = '1';
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); // Necessary to allow dropping
  };

  const handleDrop = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) return;

    const items = [...annexures];
    const draggedIndex = items.findIndex(item => item.id === draggedId);
    const targetIndex = items.findIndex(item => item.id === targetId);

    // Reorder array
    const [draggedItem] = items.splice(draggedIndex, 1);
    items.splice(targetIndex, 0, draggedItem);

    // Reassign serials
    const newOrder = items.map((item, index) => ({
      id: item.id,
      annexure_serial: index + 1
    }));

    // Optimistically update UI
    mutate({ data: items.map((item, index) => ({ ...item, annexure_serial: index + 1 })) }, false);

    // Sync with backend
    try {
      await api.put(`/agendas/annexures/reorder`, { items: newOrder });
    } catch (error) {
      toast.error("Failed to save reordered annexures");
      mutate(); // revert on failure
    }
  };

  return (
    <div className="mt-6 border-t border-border pt-6 animate-in fade-in duration-300">
      <ConfirmModal />
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground">
          <Paperclip className="w-4 h-4" /> 
          Annexures ({annexures.length})
        </h3>
        
        <div>
          <input 
            type="file" 
            className="hidden" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
          />
          {!readOnly && (
            <button 
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="text-xs font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              {isUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Add Annexure
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {annexures.length === 0 ? (
          <div className="text-center py-6 bg-muted/30 border border-dashed border-border rounded-lg">
            <p className="text-xs text-muted-foreground">No annexures attached yet.</p>
          </div>
        ) : (
          annexures.map((annexure) => (
            <div 
              key={annexure.id}
              draggable={!readOnly}
              onDragStart={(e) => !readOnly && handleDragStart(e, annexure.id)}
              onDragEnd={(!readOnly) ? handleDragEnd : undefined}
              onDragOver={(!readOnly) ? handleDragOver : undefined}
              onDrop={(e) => !readOnly && handleDrop(e, annexure.id)}
              className={`flex items-center gap-3 p-3 bg-card border border-border rounded-md group hover:border-primary/30 transition-colors shadow-sm ${(!readOnly) ? 'cursor-grab active:cursor-grabbing' : ''}`}
            >
              {!readOnly && (
                <div className="text-muted-foreground/50 group-hover:text-muted-foreground cursor-grab">
                  <GripVertical className="w-4 h-4" />
                </div>
              )}
              <div className="bg-primary/10 p-1.5 rounded text-primary">
                <File className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                {annexure.url ? (
                  <a href={annexure.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary hover:underline truncate block">
                    {annexure.file_name}
                  </a>
                ) : (
                  <p className="text-sm font-medium text-foreground truncate">{annexure.file_name}</p>
                )}
                {annexure.uploaded_by_username && (
                  <p className="text-xs text-muted-foreground truncate">
                    Uploaded by {annexure.uploaded_by_username}
                    {annexure.upload_date ? ` · ${new Date(annexure.upload_date).toLocaleDateString()}` : ""}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                {annexure.url && (
                  <a 
                    href={annexure.url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="p-1.5 text-muted-foreground hover:text-primary bg-muted rounded-md transition-colors"
                    title="View File"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
                {!readOnly && (
                  <button
                    onClick={() => handleDelete(annexure.id)}
                    className="p-1.5 text-muted-foreground hover:text-destructive bg-muted rounded-md transition-colors"
                    title="Delete Annexure"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
