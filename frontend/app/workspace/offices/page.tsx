"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "../../../lib/api";
import api from "../../../lib/api";
import DataTable from "../../../components/DataTable";
import { toast } from "sonner";
import { useConfirm } from "../../../hooks/useConfirm";
import { useAuth } from "../../../hooks/useAuth";

export default function ManageOfficesPage() {
  const { canEdit } = useAuth();
  const { data: response, error, mutate } = useSWR('/offices', fetcher);
  const { confirm, ConfirmModal } = useConfirm();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newOffice, setNewOffice] = useState({
    name_bangla: "",
    name_english: ""
  });

  const columns = [
    { key: "serial", label: "Serial No" },
    { key: "name_english", label: "Office Name" },
    { key: "name_bangla", label: "Office Name (Bangla)" },
  ];

  const handleReorder = async (newOrder: any[]) => {
    try {
      await api.put('/offices/reorder', { items: newOrder });
      mutate();
    } catch (err) {
      console.error(err);
      toast.error('Failed to reorder offices');
    }
  };

  const handleUploadCsv = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    try {
      await api.post('/offices/upload-csv', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      mutate();
      toast.success('CSV uploaded successfully!');
    } catch (err) {
      console.error(err);
      toast.error('Failed to upload CSV');
    }
  };

  const handleDownloadCsv = () => {
    window.location.href = `${api.defaults.baseURL}/offices/download-csv`;
  };

  const handleEdit = (office: any) => {
    setIsEditMode(true);
    setEditingId(office.id);
    setNewOffice({ name_bangla: office.name_bangla, name_english: office.name_english });
    setIsModalOpen(true);
  };

  const handleDelete = (office: any) => {
    confirm("Delete Office", "Are you sure you want to delete this office?", async () => {
      try {
        await api.delete(`/offices/${office.id}`);
        mutate();
        toast.success('Office deleted successfully');
      } catch (err) {
        console.error(err);
        toast.error('Failed to delete office');
      }
    });
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isEditMode && editingId) {
        await api.put(`/offices/${editingId}`, newOffice);
      } else {
        await api.post('/offices', newOffice);
      }
      setIsModalOpen(false);
      setIsEditMode(false);
      setEditingId(null);
      setNewOffice({ name_bangla: "", name_english: "" });
      mutate();
      toast.success(isEditMode ? 'Office updated successfully' : 'Office created successfully');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to save office');
    }
  };

  if (error) return <div className="p-8">Failed to load offices</div>;
  if (!response) return <div className="p-8">Loading...</div>;

  return (
    <div className="max-w-6xl mx-auto">
      <ConfirmModal />
      <DataTable
        columns={columns}
        data={response.data || []}
        title="Manage Offices"
        searchable
        searchPlaceholder="Search offices..."
        onReorder={canEdit ? handleReorder : undefined}
        onUploadCsv={canEdit ? handleUploadCsv : undefined}
        onDownloadCsv={handleDownloadCsv}
        onAdd={canEdit ? () => {
          setIsEditMode(false);
          setEditingId(null);
          setNewOffice({ name_bangla: "", name_english: "" });
          setIsModalOpen(true);
        } : undefined}
        onEdit={canEdit ? handleEdit : undefined}
        onDelete={canEdit ? handleDelete : undefined}
      />

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card w-full max-w-md rounded-lg shadow-xl border border-border p-6 relative">
            <h3 className="text-lg font-semibold mb-4">{isEditMode ? "Edit Office" : "Add New Office"}</h3>
            <form onSubmit={handleAddSubmit} className="space-y-4">
              
              <div className="space-y-1">
                <label className="text-xs font-medium">Name (Bangla)</label>
                <input required value={newOffice.name_bangla} onChange={e => setNewOffice({...newOffice, name_bangla: e.target.value})} className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm" />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium">Name (English)</label>
                <input required value={newOffice.name_english} onChange={e => setNewOffice({...newOffice, name_english: e.target.value})} className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm" />
              </div>

              <div className="flex justify-end space-x-2 pt-4">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm bg-muted text-muted-foreground rounded-md hover:bg-muted/80">Cancel</button>
                <button type="submit" className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90">{isEditMode ? "Update Office" : "Save Office"}</button>
              </div>

            </form>
          </div>
        </div>
      )}
    </div>
  );
}
