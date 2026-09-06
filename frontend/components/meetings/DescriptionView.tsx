"use client";

import { useState, useEffect } from "react";
import { Save, Loader2, FileText, Check } from "lucide-react";
import RichTextEditor from "../RichTextEditor";
import api from "../../lib/api";
import { toast } from "sonner";
import TemplateDrawer from "../TemplateDrawer";
import { useAuth } from "../../hooks/useAuth";
import { canEditDescription, canEditConclusion } from "../../lib/meetingAccess";

export default function DescriptionView({ meeting, type, mutate }: { meeting: any, type: string, mutate: any }) {
  const { user } = useAuth();
  const canEdit = type === 'conclusion' ? canEditConclusion(user, meeting) : canEditDescription(user, meeting);
  const [content, setContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const title = type === 'description' ? 'Meeting Description' : 'Meeting Conclusion';
  const dbField = type === 'description' ? 'description' : 'conclusion';
  const templateType = type === 'description' ? 'description' : 'conclusion';
  const readOnly = !canEdit;

  // Re-initialize content when switching between Description and Conclusion
  useEffect(() => {
    setContent(meeting[dbField] || "");
    setIsDirty(false);
  }, [type, meeting, dbField]);

  const handleSave = async () => {
    if (!isDirty || isSaving) return;
    setIsSaving(true);
    try {
      await api.put(`/meetings/${meeting.id}`, { [dbField]: content });
      mutate();
      setIsDirty(false);
      toast.success(`${title} saved successfully.`);
    } catch (error) {
      toast.error(`Failed to save ${title.toLowerCase()}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-5xl h-full min-h-[calc(100vh-220px)] flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-500 pb-8">
      <div className="flex justify-between items-center mb-6 shrink-0">
        <h2 className="text-2xl font-bold">{title}</h2>
      </div>

      <div className="flex-1 flex flex-col bg-card border border-border rounded-lg shadow-sm overflow-hidden relative min-h-[450px]">
        <RichTextEditor
          content={content}
          editable={!readOnly}
          onChange={(html) => {
            setContent(html);
            setIsDirty(true);
          }}
          onSave={handleSave}
          className="p-8 flex-1 min-h-[350px]"
        />

        {/* Action Area */}
        {!readOnly && (
          <div className="bg-muted/30 border-t border-border p-4 flex justify-between items-center shrink-0">
            <button 
              onClick={() => setIsDrawerOpen(true)}
              className="text-primary hover:text-primary/80 font-medium px-4 py-2 transition-colors flex items-center gap-2 text-sm"
            >
              <FileText className="w-4 h-4" /> From Template
            </button>

            <div className="flex items-center gap-3">
              {isDirty && (
                <span className="text-xs font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1.5 animate-pulse">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  Unsaved changes
                </span>
              )}
              <button 
                onClick={handleSave}
                disabled={!isDirty || isSaving}
                className={`py-2 px-6 rounded-md font-medium text-sm flex items-center gap-2 transition-all shadow-sm ${
                  isSaving
                    ? "bg-primary/70 text-primary-foreground cursor-wait opacity-80"
                    : isDirty
                    ? "bg-primary text-primary-foreground hover:bg-primary/90 ring-2 ring-primary/30 font-semibold cursor-pointer shadow-md"
                    : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 dark:bg-emerald-500/20 cursor-default opacity-90"
                }`}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : isDirty ? (
                  <>
                    <Save className="w-4 h-4" />
                    <span>Save {type === 'description' ? 'Description' : 'Conclusion'}</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span>{type === 'description' ? 'Description' : 'Conclusion'} Saved</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
      
      <TemplateDrawer 
        isOpen={isDrawerOpen} 
        onClose={() => setIsDrawerOpen(false)} 
        type={templateType as any}
        onSelect={(templateContent) => {
          setContent(templateContent);
          setIsDirty(true);
        }}
      />
    </div>
  );
}
