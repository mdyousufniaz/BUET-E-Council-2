"use client";

import { useState } from "react";
import useSWR from "swr";
import api, { fetcher } from "../../../lib/api";
import DataTable from "../../../components/DataTable";
import SearchableSelect from "../../../components/SearchableSelect";
import { toast } from "sonner";
import { useConfirm } from "../../../hooks/useConfirm";

export default function ManageUsersPage() {
  const { data: response, error, mutate } = useSWR('/auth/users', fetcher);
  const { confirm, ConfirmModal } = useConfirm();
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newUser, setNewUser] = useState({
    username: "",
    email: "",
    password: "",
    role: "member",
    member_type: "none"
  });

  const columns = [
    { key: "username", label: "Username" },
    { key: "email", label: "Email" },
    { key: "role", label: "Role" },
    { key: "status", label: "Status" },
  ];

  const handleUploadCsv = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    try {
      await api.post('/auth/upload-csv', formData, {
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
    window.location.href = `${api.defaults.baseURL}/auth/download-csv`;
  };

  const handleEdit = (user: any) => {
    setIsEditMode(true);
    setEditingId(user.id);
    setNewUser({
      username: user.username || "",
      email: user.email || "",
      password: "", // Usually blank out password on edit
      role: user.role || "member",
      member_type: user.member_type || "none"
    });
    setIsModalOpen(true);
  };

  const handleDelete = (user: any) => {
    confirm("Delete User", "Are you sure you want to delete this user?", async () => {
      try {
        await api.delete(`/auth/users/${user.id}`);
        mutate();
        toast.success('User deleted successfully');
      } catch (err) {
        console.error(err);
        toast.error('Failed to delete user');
      }
    });
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isEditMode && editingId) {
        await api.put(`/auth/users/${editingId}`, newUser);
      } else {
        await api.post('/auth/signup', newUser);
      }
      setIsModalOpen(false);
      setIsEditMode(false);
      setEditingId(null);
      setNewUser({ username: "", email: "", password: "", role: "member", member_type: "none" });
      mutate();
      toast.success(isEditMode ? 'User updated successfully' : 'User created successfully');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to save user');
    }
  };

  if (error) return <div className="p-8">Failed to load users</div>;
  if (!response) return <div className="p-8">Loading...</div>;

  return (
    <div className="max-w-6xl mx-auto">
      <ConfirmModal />
      <DataTable 
        columns={columns} 
        data={response.data || []} 
        title="Manage Users"
        onUploadCsv={handleUploadCsv}
        onDownloadCsv={handleDownloadCsv}
        onAdd={() => {
          setIsEditMode(false);
          setEditingId(null);
          setNewUser({ username: "", email: "", password: "", role: "member", member_type: "none" });
          setIsModalOpen(true);
        }}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card w-full max-w-md rounded-lg shadow-xl border border-border p-6 relative">
            <h3 className="text-lg font-semibold mb-4">{isEditMode ? "Edit User" : "Add New User"}</h3>
            <form onSubmit={handleAddSubmit} className="space-y-4">
              
              <div className="space-y-1">
                <label className="text-xs font-medium">Username</label>
                <input required value={newUser.username} onChange={e => setNewUser({...newUser, username: e.target.value})} className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm" />
              </div>
              
              <div className="space-y-1">
                <label className="text-xs font-medium">Email</label>
                <input required type="email" value={newUser.email} onChange={e => setNewUser({...newUser, email: e.target.value})} className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm" />
              </div>
              
              <div className="space-y-1">
                <label className="text-xs font-medium">Password {isEditMode ? "(Leave blank to keep unchanged)" : ""}</label>
                <input type="password" required={!isEditMode} value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm" />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Role</label>
                  <SearchableSelect 
                    options={[
                      { value: "member", label: "Member" },
                      { value: "moderator", label: "Moderator" },
                      { value: "admin", label: "Admin" }
                    ]}
                    value={newUser.role}
                    onChange={(val) => setNewUser({...newUser, role: val})}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Member Type</label>
                  <SearchableSelect 
                    options={[
                      { value: "none", label: "None" },
                      { value: "academic", label: "Academic" },
                      { value: "syndicate", label: "Syndicate" }
                    ]}
                    value={newUser.member_type}
                    onChange={(val) => setNewUser({...newUser, member_type: val})}
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-4">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm bg-muted text-muted-foreground rounded-md hover:bg-muted/80">Cancel</button>
                <button type="submit" className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90">{isEditMode ? "Update User" : "Save User"}</button>
              </div>

            </form>
          </div>
        </div>
      )}
    </div>
  );
}
