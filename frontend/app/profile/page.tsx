"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import api, { fetcher } from "../../lib/api";
import { toast } from "sonner";

export default function ProfilePage() {
  const router = useRouter();
  const { data: response, error, mutate } = useSWR('/auth/me', fetcher);
  
  const [formData, setFormData] = useState({
    email: "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: ""
  });

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (response?.data) {
      setFormData(prev => ({
        ...prev,
        email: response.data.email || ""
      }));
    }
  }, [response]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.newPassword && formData.newPassword !== formData.confirmPassword) {
      return toast.error("New passwords do not match");
    }

    setSaving(true);
    try {
      const payload: any = {};
      if (formData.email !== response?.data?.email) payload.email = formData.email;
      if (formData.currentPassword && formData.newPassword) {
        payload.currentPassword = formData.currentPassword;
        payload.newPassword = formData.newPassword;
      }

      if (Object.keys(payload).length === 0) {
        setSaving(false);
        return toast.info("No changes to save");
      }

      const res = await api.put('/auth/me', payload);

      if (res.data?.passwordChanged) {
        toast.success("Password changed. You've been signed out from all devices.");
        router.push('/login');
        return;
      }

      toast.success("Profile updated successfully");
      setFormData(prev => ({ ...prev, currentPassword: "", newPassword: "", confirmPassword: "" }));
      mutate();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  if (error) return <div className="p-8">Failed to load profile</div>;
  if (!response) return <div className="p-8">Loading...</div>;

  const user = response.data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-foreground tracking-tight">Profile Settings</h2>
      </div>

      <div className="bg-card p-6 rounded-lg border border-border shadow-sm max-w-2xl">
        <form className="space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-foreground border-b border-border pb-2">Personal Information</h3>
            
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Username</label>
              <input type="text" value={user?.username || ""} disabled className="w-full px-3 py-2 bg-muted text-muted-foreground border border-input rounded-md cursor-not-allowed" />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Email</label>
              <input 
                type="email" 
                value={formData.email}
                onChange={e => setFormData({...formData, email: e.target.value})}
                className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-foreground" 
              />
            </div>
          </div>

          <div className="space-y-4 pt-4">
            <h3 className="text-lg font-medium text-foreground border-b border-border pb-2">Update Password</h3>
            
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Current Password</label>
              <input 
                type="password" 
                value={formData.currentPassword}
                onChange={e => setFormData({...formData, currentPassword: e.target.value})}
                placeholder="••••••••" 
                className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-foreground" 
              />
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">New Password</label>
                <input 
                  type="password" 
                  value={formData.newPassword}
                  onChange={e => setFormData({...formData, newPassword: e.target.value})}
                  placeholder="••••••••" 
                  className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-foreground" 
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Confirm Password</label>
                <input 
                  type="password" 
                  value={formData.confirmPassword}
                  onChange={e => setFormData({...formData, confirmPassword: e.target.value})}
                  placeholder="••••••••" 
                  className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-foreground" 
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-4">
            <button 
              type="submit" 
              disabled={saving}
              className="bg-primary text-primary-foreground px-6 py-2 rounded-md hover:opacity-90 font-medium transition-opacity disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Profile"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
