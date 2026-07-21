"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import api from "../../lib/api";
import SearchableSelect from "../SearchableSelect";
import { toast } from "sonner";
import { useConfirm } from "../../hooks/useConfirm";
import { useAuth } from "../../hooks/useAuth";
import { Lock, Unlock, Trash2, CheckCircle2 } from "lucide-react";

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
  const { isAdmin, isSuperAdmin, canEdit } = useAuth();
  const router = useRouter();
  const isLocked = meeting.is_locked;
  const isPast = formData.status === 'past';
  const readOnly = isLocked || !canEdit;

  const [saving, setSaving] = useState(false);
  const [isCompleteModalOpen, setIsCompleteModalOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState("");
  const [isCompleting, setIsCompleting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isApproving, setIsApproving] = useState(false);

  const handleDelete = () => {
    confirm("Delete Meeting", "Are you sure you want to delete this meeting? This action cannot be undone.", async () => {
      setIsDeleting(true);
      try {
        await api.delete(`/meetings/${meeting.id}`);
        toast.success("Meeting deleted successfully.");
        router.push('/admin/meetings');
      } catch (err: any) {
        toast.error(err.response?.data?.message || 'Failed to delete meeting');
      } finally {
        setIsDeleting(false);
      }
    });
  };

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

  const handleCompleteMeeting = async () => {
    if (confirmTitle !== formData.title) {
      toast.error("Meeting Serial Number does not match.");
      return;
    }
    
    setIsCompleting(true);
    try {
      await api.post(`/meetings/${meeting.id}/complete`, { title: confirmTitle });
      mutate();
      toast.success("Meeting marked as completed successfully.");
      setIsCompleteModalOpen(false);
      setFormData(prev => ({ ...prev, status: "past" }));
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to complete meeting');
    } finally {
      setIsCompleting(false);
    }
  };

  const handleApprove = async () => {
    setIsApproving(true);
    try {
      await api.put(`/meetings/${meeting.id}/approve`);
      mutate();
      toast.success('Meeting approved');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to approve meeting');
    } finally {
      setIsApproving(false);
    }
  };

  const handleToggleLock = async () => {
    const actionStr = isLocked ? "unlock" : "lock";
    confirm(`${isLocked ? 'Unlock' : 'Lock'} Meeting`, `Are you sure you want to ${actionStr} this meeting?`, async () => {
      try {
        await api.put(`/meetings/${meeting.id}/lock`);
        mutate();
        toast.success(`Meeting ${actionStr}ed successfully.`);
      } catch (err: any) {
        toast.error(err.response?.data?.message || `Failed to ${actionStr} meeting`);
      }
    });
  };

  return (
    <div className="max-w-3xl animate-in fade-in slide-in-from-bottom-4 duration-500">
      <ConfirmModal />
      
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Meeting Info</h2>
        {isAdmin && (
          <div className="flex items-center gap-3">
            {isSuperAdmin && meeting.status === 'draft' && (
              meeting.is_approved ? (
                <span className="flex items-center gap-2 px-4 py-2 rounded-md font-medium text-sm bg-emerald-100 text-emerald-700 border border-emerald-300">
                  <CheckCircle2 className="w-4 h-4" /> Approved
                </span>
              ) : (
                <button
                  onClick={handleApprove}
                  disabled={isApproving}
                  className="flex items-center gap-2 px-4 py-2 rounded-md font-medium text-sm transition-colors bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border border-emerald-300 disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" /> {isApproving ? "Approving..." : "Approve Meeting"}
                </button>
              )
            )}
            <button
              onClick={handleToggleLock}
              className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium text-sm transition-colors ${
                isLocked
                  ? "bg-amber-100 text-amber-700 hover:bg-amber-200 border border-amber-300"
                  : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border border-emerald-300"
              }`}
            >
              {isLocked ? (
                <>
                  <Unlock className="w-4 h-4" /> Unlock Meeting
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" /> Lock Meeting
                </>
              )}
            </button>
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="flex items-center gap-2 px-4 py-2 rounded-md font-medium text-sm transition-colors bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/30 disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" /> {isDeleting ? "Deleting..." : "Delete Meeting"}
            </button>
          </div>
        )}
      </div>
      
      <div className="bg-card border border-border shadow-sm rounded-lg p-6">
        <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="col-span-1 md:col-span-2 flex gap-4">
            <div className="space-y-1 w-1/3">
              <label className="text-sm font-medium">Meeting Serial Number</label>
              <input
                required
                disabled={readOnly}
                value={formData.title}
                onChange={e => setFormData({...formData, title: e.target.value})} 
                className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm disabled:opacity-50" 
                placeholder='e.g., "304th"'
              />
            </div>
            
            <div className="space-y-1 w-2/3">
              <label className="text-sm font-medium">Meeting Title</label>
              <input
                disabled={readOnly}
                value={formData.meeting_title}
                onChange={e => setFormData({...formData, meeting_title: e.target.value})} 
                className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm disabled:opacity-50" 
                placeholder='e.g., "Monthly General Meeting"'
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Date</label>
            <input 
              required 
              type="date"
              disabled={readOnly}
              value={formData.meeting_date}
              onChange={e => setFormData({...formData, meeting_date: e.target.value})} 
              className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm disabled:opacity-50" 
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Type</label>
            {readOnly ? (
              <div className="w-full px-3 py-2 bg-input/20 border border-input rounded-md text-sm opacity-50 cursor-not-allowed">
                {typeOptions.find(o => o.value === formData.type)?.label || formData.type}
              </div>
            ) : (
              <SearchableSelect 
                options={typeOptions}
                value={formData.type}
                onChange={(val) => setFormData({...formData, type: val})}
              />
            )}
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Status</label>
            {readOnly || isPast ? (
              <div className="w-full px-3 py-2 bg-input/20 border border-input rounded-md text-sm opacity-50 cursor-not-allowed">
                {statusOptions.find(o => o.value === formData.status)?.label || formData.status}
              </div>
            ) : (
              <SearchableSelect 
                options={statusOptions}
                value={formData.status}
                onChange={(val) => setFormData({...formData, status: val})}
              />
            )}
          </div>

          {!readOnly && (
            <div className="col-span-1 md:col-span-2 flex justify-end mt-4">
              <button
                type="submit"
                disabled={saving}
                className="bg-primary text-primary-foreground py-2 px-6 rounded-md font-medium shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          )}
        </form>

        {!isPast && !readOnly && (
          <>
            <hr className="my-8 border-border" />
            <div>
              <h3 className="text-lg font-medium mb-2">Completion Actions</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Marking a meeting as completed will lock its contents and transition its state to finalized.
              </p>
              <button 
                onClick={() => {
                  setConfirmTitle("");
                  setIsCompleteModalOpen(true);
                }}
                className="bg-secondary text-secondary-foreground border border-secondary font-semibold hover:bg-secondary/80 px-6 py-2 rounded-md transition-colors"
              >
                Mark Meeting Completed
              </button>
            </div>
          </>
        )}

        {/* Custom Confirmation Modal for Completion */}
        {isCompleteModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
            <div className="bg-card w-full max-w-md rounded-lg shadow-xl border border-border flex flex-col p-6 animate-in zoom-in-95 duration-200">
              <h2 className="text-xl font-bold mb-2">Confirm Meeting Completion</h2>
              <p className="text-sm text-muted-foreground mb-4">
                This action is irreversible. The meeting status will be set to Past, and present members will be moved to the final Presentees list.
              </p>
              
              <div className="space-y-2 mb-6">
                <label className="text-sm font-medium text-destructive">
                  Type <span className="font-bold">"{formData.title}"</span> to confirm:
                </label>
                <input 
                  type="text" 
                  value={confirmTitle}
                  onChange={(e) => setConfirmTitle(e.target.value)}
                  placeholder="Meeting Serial Number"
                  className="w-full px-3 py-2 bg-input/20 border border-destructive/50 rounded-md focus:ring-1 focus:ring-destructive focus:border-destructive text-sm"
                />
              </div>

              <div className="flex justify-end gap-3">
                <button 
                  onClick={() => setIsCompleteModalOpen(false)}
                  disabled={isCompleting}
                  className="px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground rounded-md transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleCompleteMeeting}
                  disabled={confirmTitle !== formData.title || isCompleting}
                  className="px-4 py-2 bg-destructive text-destructive-foreground hover:bg-destructive/90 text-sm font-medium rounded-md shadow-sm transition-colors disabled:opacity-50"
                >
                  {isCompleting ? "Processing..." : "Complete Meeting"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
