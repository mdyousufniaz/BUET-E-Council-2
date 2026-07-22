"use client";

import { useState, useEffect } from "react";
import { Save, Loader2, FileText } from "lucide-react";
import RichTextEditor from "../RichTextEditor";
import api from "../../lib/api";
import { toast } from "sonner";
import TemplateDrawer from "../TemplateDrawer";
import { useAuth } from "../../hooks/useAuth";
import { canAuthorMeeting } from "../../lib/meetingAccess";

export default function DescriptionView({ meeting, type, mutate }: { meeting: any, type: string, mutate: any }) {
  const { user } = useAuth();
  const canEdit = canAuthorMeeting(user, meeting);
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
    <div className="max-w-5xl h-full flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
      <div className="flex justify-between items-center mb-6 shrink-0">
        <h2 className="text-2xl font-bold">{title}</h2>
      </div>

      <div className="flex-1 flex flex-col bg-card border border-border rounded-lg shadow-sm overflow-hidden relative">
        <RichTextEditor
          content={content}
          editable={!readOnly}
          onChange={(html) => {
            setContent(html);
            setIsDirty(true);
          }}
          className="p-8"
        />

        {/* Action Area */}
        {!readOnly && (
          <div className="bg-muted/30 border-t border-border p-4 flex justify-between shrink-0">
            <button 
              onClick={() => setIsDrawerOpen(true)}
            className="text-primary hover:text-primary/80 font-medium px-4 py-2 transition-colors flex items-center gap-2"
          >
            <FileText className="w-4 h-4" /> From Template
          </button>

          <button 
            onClick={handleSave}
            disabled={!isDirty || isSaving}
            className="bg-primary text-primary-foreground hover:opacity-90 px-6 py-2 rounded-md font-medium disabled:opacity-50 transition-opacity flex items-center gap-2 shadow-sm"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save {type === 'description' ? 'Description' : 'Conclusion'}
          </button>
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
