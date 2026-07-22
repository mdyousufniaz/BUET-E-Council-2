"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "../../../lib/api";
import api from "../../../lib/api";
import DataTable from "../../../components/DataTable";
import SearchableSelect from "../../../components/SearchableSelect";
import { toast } from "sonner";
import { useConfirm } from "../../../hooks/useConfirm";
import { useAuth } from "../../../hooks/useAuth";

export default function ManageDepartmentsPage() {
  const { canEdit } = useAuth();
  const { data: response, error, mutate } = useSWR('/departments', fetcher);
  const { confirm, ConfirmModal } = useConfirm();
  const { data: facultyRes } = useSWR('/faculties', fetcher);
  
  const faculties = facultyRes?.data || [];
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newDepartment, setNewDepartment] = useState({
    name_bangla: "",
    name_english: "",
    alias_bangla: "",
    alias_english: "",
    faculty_id: "",
    serial: ""
  });

  const columns = [
    { key: "serial", label: "Serial No" },
    { key: "name_english", label: "Department Name" },
    { key: "alias_english", label: "Alias" },
    { key: "faculty_name", label: "Faculty" },
  ];

  const handleReorder = async (newOrder: any[]) => {
    try {
      await api.put('/departments/reorder', { items: newOrder });
      mutate();
    } catch (err) {
      console.error(err);
      toast.error('Failed to reorder departments');
    }
  };

  const handleUploadCsv = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    try {
      await api.post('/departments/upload-csv', formData, {
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
    window.location.href = `${api.defaults.baseURL}/departments/download-csv`;
  };

  const handleEdit = (department: any) => {
    setIsEditMode(true);
    setEditingId(department.id);
    setNewDepartment({
      name_bangla: department.name_bangla || "",
      name_english: department.name_english || "",
      alias_bangla: department.alias_bangla || "",
      alias_english: department.alias_english || "",
      faculty_id: department.faculty_id || "",
      serial: department.serial != null ? String(department.serial) : ""
    });
    setIsModalOpen(true);
  };

  const handleDelete = (department: any) => {
    confirm("Delete Department", "Are you sure you want to delete this department?", async () => {
      try {
        await api.delete(`/departments/${department.id}`);
        mutate();
        toast.success('Department deleted successfully');
      } catch (err) {
        console.error(err);
        toast.error('Failed to delete department');
      }
    });
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        ...newDepartment,
        serial: newDepartment.serial === "" ? undefined : parseInt(newDepartment.serial, 10)
      };
      if (isEditMode && editingId) {
        await api.put(`/departments/${editingId}`, payload);
      } else {
        await api.post('/departments', payload);
      }
      setIsModalOpen(false);
      setIsEditMode(false);
      setEditingId(null);
      setNewDepartment({ name_bangla: "", name_english: "", alias_bangla: "", alias_english: "", faculty_id: "", serial: "" });
      mutate();
      toast.success(isEditMode ? 'Department updated successfully' : 'Department created successfully');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to save department');
    }
  };

  if (error) return <div className="p-8">Failed to load departments</div>;
  if (!response) return <div className="p-8">Loading...</div>;

  return (
    <div className="max-w-6xl mx-auto">
      <ConfirmModal />
      <DataTable
        columns={columns}
        data={response.data || []}
        title="Manage Departments"
        searchable
        searchPlaceholder="Search departments..."
        onReorder={canEdit ? handleReorder : undefined}
        onUploadCsv={canEdit ? handleUploadCsv : undefined}
        onDownloadCsv={handleDownloadCsv}
        onAdd={canEdit ? () => {
          setIsEditMode(false);
          setEditingId(null);
          setNewDepartment({ name_bangla: "", name_english: "", alias_bangla: "", alias_english: "", faculty_id: "", serial: "" });
          setIsModalOpen(true);
        } : undefined}
        onEdit={canEdit ? handleEdit : undefined}
        onDelete={canEdit ? handleDelete : undefined}
      />

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card w-full max-w-lg rounded-lg shadow-xl border border-border p-6 relative max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">{isEditMode ? "Edit Department" : "Add New Department"}</h3>
            <form onSubmit={handleAddSubmit} className="space-y-4">
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Name (Bangla)</label>
                  <input required value={newDepartment.name_bangla} onChange={e => setNewDepartment({...newDepartment, name_bangla: e.target.value})} className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Name (English)</label>
                  <input required value={newDepartment.name_english} onChange={e => setNewDepartment({...newDepartment, name_english: e.target.value})} className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Alias (Bangla)</label>
                  <input required value={newDepartment.alias_bangla} onChange={e => setNewDepartment({...newDepartment, alias_bangla: e.target.value})} className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Alias (English)</label>
                  <input required value={newDepartment.alias_english} onChange={e => setNewDepartment({...newDepartment, alias_english: e.target.value})} className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Faculty</label>
                  <SearchableSelect
                    options={faculties.map((f: any) => ({ value: f.id, label: f.name_english }))}
                    value={newDepartment.faculty_id}
                    onChange={(val) => setNewDepartment({...newDepartment, faculty_id: val})}
                    placeholder="Select Faculty..."
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Serial No</label>
                  <input
                    type="number"
                    min={1}
                    value={newDepartment.serial}
                    onChange={e => setNewDepartment({...newDepartment, serial: e.target.value})}
                    placeholder="Auto-assigned if left blank"
                    className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-4">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm bg-muted text-muted-foreground rounded-md hover:bg-muted/80">Cancel</button>
                <button type="submit" className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90">{isEditMode ? "Update Department" : "Save Department"}</button>
              </div>

            </form>
          </div>
        </div>
      )}
    </div>
  );
}
