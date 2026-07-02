"use client";

import { useState } from "react";
import api from "../../lib/api";
import SearchableSelect from "../SearchableSelect";
import { toast } from "sonner";
import { useConfirm } from "../../hooks/useConfirm";

const typeOptions = [
  { value: "syndicate", label: "Syndicate" },
  { value: "academic", label: "Academic" }
];

const statusOptions = [
  { value: "draft", label: "Draft" },
  { value: "ongoing", label: "Ongoing" },
  { value: "past", label: "Past" }
];

export default function MeetingInfoView({ meeting, mutate }: { meeting: any, mutate: any }) {
  const [formData, setFormData] = useState({
    title: meeting.title || "",
    meeting_title: meeting.meeting_title || "",
    meeting_date: meeting.meeting_date ? new Date(meeting.meeting_date).toISOString().split('T')[0] : "",
    type: meeting.type || "syndicate",
    status: meeting.status || "draft"
  });
  const { confirm, ConfirmModal } = useConfirm();

  const [saving, setSaving] = useState(false);

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...formData,
        meeting_date: new Date(formData.meeting_date).toISOString()
      };
      await api.put(`/meetings/${meeting.id}`, payload);
      mutate();
      toast.success("Meeting info updated successfully.");
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to update meeting info');
    } finally {
      setSaving(false);
    }
  };

  const markCompleted = () => {
    confirm("Mark Meeting as Past", "Are you sure you want to mark this meeting as past? This will lock appropriate fields.", async () => {
      setFormData(prev => ({ ...prev, status: "past" }));
      setSaving(true);
      try {
        const payload = {
          ...formData,
          status: "past",
          meeting_date: new Date(formData.meeting_date).toISOString()
        };
        await api.put(`/meetings/${meeting.id}`, payload);
        mutate();
        toast.success("Meeting marked as past successfully.");
      } catch (err: any) {
        toast.error(err.response?.data?.message || 'Failed to lock meeting');
      } finally {
        setSaving(false);
      }
    });
  };

  return (
    <div className="max-w-3xl animate-in fade-in slide-in-from-bottom-4 duration-500">
      <ConfirmModal />
      <h2 className="text-2xl font-bold mb-6">Meeting Info</h2>
      
      <div className="bg-card border border-border shadow-sm rounded-lg p-6">
        <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="col-span-1 md:col-span-2 flex gap-4">
            <div className="space-y-1 w-1/3">
              <label className="text-sm font-medium">Meeting Serial Number</label>
              <input 
                required 
                disabled={formData.status === 'past'}
                value={formData.title} 
                onChange={e => setFormData({...formData, title: e.target.value})} 
                className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm disabled:opacity-50" 
                placeholder='e.g., "304th"'
              />
            </div>
            
            <div className="space-y-1 w-2/3">
              <label className="text-sm font-medium">Meeting Title</label>
              <input 
                disabled={formData.status === 'past'}
                value={formData.meeting_title} 
                onChange={e => setFormData({...formData, meeting_title: e.target.value})} 
                className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm disabled:opacity-50" 
                placeholder='e.g., "Monthly General Meeting"'
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Meeting Date</label>
            <input 
              required 
              type="date" 
              value={formData.meeting_date} 
              onChange={e => setFormData({...formData, meeting_date: e.target.value})} 
              className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm" 
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Meeting Type</label>
            <SearchableSelect 
              options={typeOptions}
              value={formData.type}
              onChange={(val) => setFormData({...formData, type: val})}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Meeting Status</label>
            <SearchableSelect 
              options={statusOptions}
              value={formData.status}
              onChange={(val) => setFormData({...formData, status: val})}
            />
          </div>

          <div className="md:col-span-2 pt-2">
            <button 
              type="submit" 
              disabled={saving}
              className="bg-primary text-primary-foreground hover:opacity-90 px-6 py-2 rounded-md font-medium disabled:opacity-50 transition-opacity"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>

        {formData.status !== 'past' && (
          <>
            <hr className="my-8 border-border" />
            <div>
              <h3 className="text-lg font-medium mb-2">Completion Actions</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Marking a meeting as completed will lock its contents and transition its state to finalized.
              </p>
              <button 
                onClick={markCompleted}
                className="bg-secondary text-secondary-foreground border border-secondary font-semibold hover:bg-secondary/80 px-6 py-2 rounded-md transition-colors"
              >
                Mark Meeting Completed
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
