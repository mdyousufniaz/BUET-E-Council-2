"use client";

import { useState } from "react";
import useSWR from "swr";
import api, { fetcher } from "../../../lib/api";
import DataTable from "../../../components/DataTable";
import SearchableSelect from "../../../components/SearchableSelect";
import CustomSelect from "../../../components/CustomSelect";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useConfirm } from "../../../hooks/useConfirm";
import JsonImportDialog from "../../../components/meetings/JsonImportDialog";
import { FileJson, Calendar, CheckCircle2, Lock, ArrowRightLeft } from "lucide-react";
import { useAuth } from "../../../hooks/useAuth";

export default function ManageMeetingsPage() {
  const { canCreateMeeting, isAdmin } = useAuth();
  const router = useRouter();
  const { data: response, error, mutate } = useSWR('/meetings', fetcher);
  const { confirm, ConfirmModal } = useConfirm();

  const [typeFilter, setTypeFilter] = useState<'all' | 'academic' | 'syndicate'>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isJsonModalOpen, setIsJsonModalOpen] = useState(false);

  const [newMeeting, setNewMeeting] = useState({
    title: "",
    meeting_title: "",
    meeting_date: "",
    type: "syndicate",
    criteria: "regular"
  });

  const typeOptions = [
    { value: "syndicate", label: "Syndicate" },
    { value: "academic", label: "Academic" }
  ];

  const criteriaOptions = [
    { value: "regular", label: "Regular" },
    { value: "emergency", label: "Emergency" }
  ];

  const columns = [
    { key: "title", label: "Meeting No." },
    { key: "meeting_title", label: "Meeting Title" },
    { key: "creator_username", label: "Initiator" },
    { key: "status_badge", label: "Status", sortable: false },
    { key: "date", label: "Date" }
  ];

  const handleEdit = (meeting: any) => {
    router.push(`/workspace/meetings/${meeting.id}?view=info`);
  };

  const handleDelete = (meeting: any) => {
    confirm("Delete Meeting", "Are you sure you want to delete this meeting?", async () => {
      try {
        await api.delete(`/meetings/${meeting.id}`);
        mutate();
        toast.success('Meeting deleted successfully');
      } catch (err) {
        console.error(err);
        toast.error('Failed to delete meeting');
      }
    });
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { criteria, ...meetingFields } = newMeeting;
      const payload = {
        ...meetingFields,
        meeting_date: new Date(newMeeting.meeting_date).toISOString()
      };

      const res = await api.post('/meetings', payload);

      if (criteria === 'emergency' && res.data?.data?.id) {
        window.localStorage.setItem(`meeting_criteria_${res.data.data.id}`, 'emergency');
      }

      setIsModalOpen(false);
      setNewMeeting({ title: "", meeting_title: "", meeting_date: "", type: "syndicate", criteria: "regular" });
      mutate();
      toast.success('Meeting created successfully');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to save meeting');
    }
  };

  if (error) return <div className="p-8">Failed to load meetings</div>;
  if (!response) return <div className="p-8">Loading...</div>;

  const allMeetings = response.data || [];

  const meetings = allMeetings
    .filter((m: any) => typeFilter === 'all' || m.type === typeFilter)
    .map((m: any) => {
      const isCompleted = m.is_completed === true;
      return {
        ...m,
        creator_username: m.creator_username || '—',
        status_badge: isCompleted ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
            <CheckCircle2 className="w-3 h-3" /> Completed
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
            <Calendar className="w-3 h-3" /> Active
          </span>
        ),
      };
    });

  return (
    <div className="max-w-6xl mx-auto">
      <ConfirmModal />

      <DataTable
        key={typeFilter}
        columns={columns}
        data={meetings}
        title="Manage Meetings"
        filters={
          <div className="w-44">
            <CustomSelect
              value={typeFilter}
              onChange={(val) => setTypeFilter(val as 'all' | 'academic' | 'syndicate')}
              options={[
                { value: "all", label: "All Types" },
                { value: "academic", label: "Academic" },
                { value: "syndicate", label: "Syndicate" }
              ]}
            />
          </div>
        }
        onAdd={canCreateMeeting ? () => {
          setNewMeeting({ title: "", meeting_title: "", meeting_date: "", type: "syndicate", criteria: "regular" });
          setIsModalOpen(true);
        } : undefined}
        onEdit={handleEdit}
        onDelete={isAdmin ? handleDelete : undefined}
        onView={(meeting) => window.open(`/workspace/meetings/${meeting.id}?view=info`, '_self')}
        customActions={
          canCreateMeeting && (
            <button
              onClick={() => setIsJsonModalOpen(true)}
              className="flex items-center gap-2 bg-secondary text-secondary-foreground px-4 py-2 rounded-md hover:bg-secondary/80 transition-colors text-sm font-medium"
            >
              <FileJson className="w-4 h-4" />
              + Import Meeting
            </button>
          )
        }
      />

      {isJsonModalOpen && (
        <JsonImportDialog 
          onClose={() => setIsJsonModalOpen(false)}
          onImportSuccess={() => {
            setIsJsonModalOpen(false);
            mutate();
          }}
        />
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card w-full max-w-md rounded-lg shadow-xl border border-border p-6 relative">
            <h3 className="text-lg font-semibold mb-4">Add New Meeting</h3>
            <form onSubmit={handleAddSubmit} className="space-y-4">

              <div className="space-y-1">
                <label className="text-xs font-medium">Meeting Serial Number (e.g., "304th")</label>
                <input required value={newMeeting.title} onChange={e => setNewMeeting({ ...newMeeting, title: e.target.value })} className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm" />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium">Meeting Title</label>
                <input required value={newMeeting.meeting_title} onChange={e => setNewMeeting({ ...newMeeting, meeting_title: e.target.value })} className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm" placeholder="e.g. Disciplinary Committee Meeting" />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium">Meeting Date</label>
                <input required type="date" value={newMeeting.meeting_date} onChange={e => setNewMeeting({ ...newMeeting, meeting_date: e.target.value })} className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm" />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium">Type</label>
                <SearchableSelect
                  options={typeOptions}
                  value={newMeeting.type}
                  onChange={(val) => setNewMeeting({ ...newMeeting, type: val })}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium">Meeting Criteria</label>
                <SearchableSelect
                  options={criteriaOptions}
                  value={newMeeting.criteria}
                  onChange={(val) => setNewMeeting({ ...newMeeting, criteria: val })}
                />
              </div>

              <div className="flex justify-end space-x-2 pt-4">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm bg-muted text-muted-foreground rounded-md hover:bg-muted/80">Cancel</button>
                <button type="submit" className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90">Create Meeting</button>
              </div>

            </form>
          </div>
        </div>
      )}
    </div>
  );
}
