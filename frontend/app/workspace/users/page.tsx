"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import api, { fetcher } from "../../../lib/api";
import DataTable from "../../../components/DataTable";
import SearchableSelect from "../../../components/SearchableSelect";
import { toast } from "sonner";
import { useConfirm } from "../../../hooks/useConfirm";
import { useAuth } from "../../../hooks/useAuth";

export default function ManageUsersPage() {
  const router = useRouter();
  const { isAdmin, isLoading: authLoading } = useAuth();
  const { data: response, error, mutate } = useSWR(isAdmin ? '/auth/users' : null, fetcher);
  const { confirm, ConfirmModal } = useConfirm();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [generatePassword, setGeneratePassword] = useState(true);
  const [newUser, setNewUser] = useState({
    username: "",
    email: "",
    password: "",
    role: "viewer",
    member_type: "none",
    status: "active"
  });

  useEffect(() => {
    // User management is admin-only; bounce anyone else back to the dashboard.
    if (!authLoading && !isAdmin) {
      router.replace('/workspace');
    }
  }, [authLoading, isAdmin, router]);

  const columns = [
    { key: "username", label: "Username" },
    { key: "email", label: "Email" },
    { key: "role", label: "Role" },
    { key: "status", label: "Status" },
  ];

  const resetForm = () => {
    setGeneratePassword(true);
    setNewUser({ username: "", email: "", password: "", role: "viewer", member_type: "none", status: "active" });
  };

  const handleUploadCsv = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast.error('File must be a .csv file');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await api.post('/auth/upload-csv', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      mutate();
      toast.success(res.data?.message || 'CSV uploaded successfully!');
    } catch (err: any) {
      console.error(err);
      const data = err.response?.data;
      const detail = Array.isArray(data?.errors) && data.errors.length > 0 ? ` ${data.errors[0]}` : '';
      toast.error((data?.message || 'Failed to upload CSV') + detail);
    }
  };

  const handleDownloadCsv = () => {
    window.location.href = `${api.defaults.baseURL}/auth/download-csv`;
  };

  const handleEdit = (user: any) => {
    setIsEditMode(true);
    setEditingId(user.id);
    setGeneratePassword(false);
    setNewUser({
      username: user.username || "",
      email: user.email || "",
      password: "", // Usually blank out password on edit
      role: user.role || "viewer",
      member_type: user.member_type || "none",
      status: user.status || "active"
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
        toast.success('User updated successfully');
      } else {
        const payload = generatePassword ? { ...newUser, password: undefined } : newUser;
        const res = await api.post('/auth/signup', payload);
        const generated = res.data?.generated_password;
        if (generated) {
          try {
            await navigator.clipboard.writeText(generated);
            toast.success(`User created. Password (copied to clipboard): ${generated}`, { duration: 15000 });
          } catch {
            toast.success(`User created. Password: ${generated}`, { duration: 15000 });
          }
        } else {
          toast.success('User created successfully');
        }
      }
      setIsModalOpen(false);
      setIsEditMode(false);
      setEditingId(null);
      resetForm();
      mutate();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to save user');
    }
  };

  if (authLoading || !isAdmin) return <div className="p-8">Loading...</div>;
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
          resetForm();
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

              {!isEditMode && (
                <div className="flex items-center space-x-4 text-xs">
                  <label className="flex items-center space-x-1.5 cursor-pointer">
                    <input type="radio" checked={generatePassword} onChange={() => setGeneratePassword(true)} />
                    <span>Generate password randomly</span>
                  </label>
                  <label className="flex items-center space-x-1.5 cursor-pointer">
                    <input type="radio" checked={!generatePassword} onChange={() => setGeneratePassword(false)} />
                    <span>Enter manually</span>
                  </label>
                </div>
              )}

              {(isEditMode || !generatePassword) && (
                <div className="space-y-1">
                  <label className="text-xs font-medium">Password {isEditMode ? "(Leave blank to keep unchanged)" : ""}</label>
                  <input type="password" required={!isEditMode} value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm" />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Role</label>
                  <SearchableSelect
                    options={[
                      { value: "viewer", label: "Viewer" },
                      { value: "file_initiator", label: "File Initiator" },
                      { value: "moderator", label: "Moderator" },
                      { value: "admin", label: "Admin" },
                      { value: "superadmin", label: "Super Admin" }
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
                <div className="space-y-1">
                  <label className="text-xs font-medium">Status</label>
                  <SearchableSelect
                    options={[
                      { value: "active", label: "Active" },
                      { value: "inactive", label: "Inactive" }
                    ]}
                    value={newUser.status}
                    onChange={(val) => setNewUser({...newUser, status: val})}
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
