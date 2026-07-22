"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "../../../lib/api";
import api from "../../../lib/api";
import DataTable from "../../../components/DataTable";
import { toast } from "sonner";
import { useConfirm } from "../../../hooks/useConfirm";
import { Plus } from "lucide-react";
import RichTextEditor from "../../../components/RichTextEditor";
import CustomSelect from "../../../components/CustomSelect";
import { useAuth } from "../../../hooks/useAuth";

export default function ManageTemplatesPage() {
  const { canManageTemplates: canEdit } = useAuth();
  const { data: response, error, mutate } = useSWR('/templates', fetcher);
  const { confirm, ConfirmModal } = useConfirm();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    text_content: "",
    type: "agendam",
    visibility: "private"
  });

  const typeOptions = [
    { value: "agendam", label: "Agenda Item" },
    { value: "resolution", label: "Resolution Item" },
    { value: "description", label: "Meeting Description" },
    { value: "conclusion", label: "Meeting Conclusion" }
  ];

  const visibilityOptions = [
    { value: "private", label: "Private (Only Me)" },
    { value: "public", label: "Public (Everyone)" }
  ];

  const columns = [
    { key: "typeDisplay", label: "Template Type" },
    { key: "contentPreview", label: "Content Snippet" },
    { key: "visibilityDisplay", label: "Visibility" },
    { key: "used_count", label: "Used Count" }
  ];

  const templates = response?.data || [];

  const tableData = templates.map((t: any) => ({
    ...t,
    typeDisplay: t.type.charAt(0).toUpperCase() + t.type.slice(1),
    contentPreview: t.text_content ? t.text_content.replace(/<[^>]*>?/gm, '').substring(0, 80) + '...' : '',
    visibilityDisplay: t.visibility === 'public' ? 'Public' : 'Private'
  }));

  const handleOpenCreate = () => {
    setIsEditMode(false);
    setEditingId(null);
    setFormData({
      text_content: "",
      type: "agendam",
      visibility: "private"
    });
    setIsModalOpen(true);
  };

  const handleEdit = (row: any) => {
    setIsEditMode(true);
    setEditingId(row.id);
    setFormData({
      text_content: row.text_content || "",
      type: row.type || "agendam",
      visibility: row.visibility || "private"
    });
    setIsModalOpen(true);
  };

  const handleDelete = (row: any) => {
    confirm("Delete Template", `Are you sure you want to delete this template?`, async () => {
      try {
        await api.delete(`/templates/${row.id}`);
        mutate();
        toast.success("Template deleted successfully");
      } catch (err: any) {
        toast.error(err.response?.data?.message || "Failed to delete template");
      }
    });
  };

  const handleSave = async () => {
    if (!formData.text_content.trim() || !formData.type) {
      toast.error("Content and Type are required");
      return;
    }

    try {
      if (isEditMode && editingId) {
        await api.put(`/templates/${editingId}`, formData);
        toast.success("Template updated successfully");
      } else {
        await api.post("/templates", formData);
        toast.success("Template created successfully");
      }
      mutate();
      setIsModalOpen(false);
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to save template");
    }
  };

  if (error) return <div className="p-8 text-destructive">Failed to load templates.</div>;
  if (!response) return <div className="p-8 text-muted-foreground animate-pulse">Loading templates...</div>;

  return (
    <div className="max-w-6xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <ConfirmModal />
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-2xl font-semibold text-foreground tracking-tight">Manage Templates</h2>
          <p className="text-muted-foreground mt-1 text-sm">Create reusable content templates for agendas, resolutions, and more.</p>
        </div>
        {canEdit && (
          <button
            onClick={handleOpenCreate}
            className="bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md font-medium transition-colors shadow-sm flex items-center gap-2"
          >
            <Plus className="w-5 h-5" /> Add Template
          </button>
        )}
      </div>

      <DataTable
        // title="Templates"
        columns={columns}
        data={tableData}
        onEdit={canEdit ? handleEdit : undefined}
        onDelete={canEdit ? handleDelete : undefined}
      />

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="bg-card w-full max-w-3xl rounded-lg shadow-xl border border-border flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-border shrink-0 flex justify-between items-center">
              <h3 className="text-lg font-semibold">{isEditMode ? "Edit Template" : "Add New Template"}</h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                &times;
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6 flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Template Type</label>
                  <CustomSelect
                    options={typeOptions}
                    value={formData.type}
                    onChange={(value) => setFormData({ ...formData, type: value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Visibility</label>
                  <CustomSelect
                    options={visibilityOptions}
                    value={formData.visibility}
                    onChange={(value) => setFormData({ ...formData, visibility: value })}
                  />
                </div>
              </div>

              <div className="space-y-2 flex-1 flex flex-col min-h-[300px]">
                <label className="text-sm font-medium">Content</label>
                <div className="border border-input rounded-md flex-1 overflow-hidden">
                  <RichTextEditor
                    content={formData.text_content}
                    onChange={(html) => setFormData({ ...formData, text_content: html })}
                    className="p-4"
                  />
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-border shrink-0 flex justify-end gap-3 bg-muted/30">
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium rounded-md shadow-sm transition-colors"
              >
                {isEditMode ? "Save Changes" : "Create Template"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
