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
import { FileJson, Bell, AlertTriangle } from "lucide-react";
import { useAuth } from "../../../hooks/useAuth";
import {
  APPROVAL_LABELS,
  APPROVAL_BADGE_CLASSES,
  isMeetingOwner,
  type ApprovalStatus,
} from "../../../lib/meetingAccess";

export default function ManageMeetingsPage() {
  const { canCreateMeeting, isAdmin, canReview, isInitiator, user } = useAuth();
  const router = useRouter();
  const { data: response, error, mutate } = useSWR('/meetings', fetcher);
  const { confirm, ConfirmModal } = useConfirm();

  const [typeFilter, setTypeFilter] = useState<'all' | 'academic' | 'syndicate'>('all');
  const [approvalFilter, setApprovalFilter] = useState<'all' | ApprovalStatus>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isJsonModalOpen, setIsJsonModalOpen] = useState(false);

  const [newMeeting, setNewMeeting] = useState({
    title: "",
    meeting_title: "",
    meeting_date: "",
    type: "syndicate",
    status: "draft"
  });

  const typeOptions = [
    { value: "syndicate", label: "Syndicate" },
    { value: "academic", label: "Academic" }
  ];

  const statusOptions = [
    { value: "draft", label: "Draft" },
    { value: "ongoing", label: "Ongoing" },
    { value: "past", label: "Past" },
  ];

  const columns = [
    { key: "title", label: "Meeting No." },
    { key: "meeting_title", label: "Meeting Title" },
    { key: "creator_username", label: "Initiator" },
    { key: "approval_label", label: "Approval", sortable: false },
    { key: "status", label: "Status" },
    { key: "date", label: "Date" }
  ];

  const handleEdit = (meeting: any) => {
    router.push(`/admin/meetings/${meeting.id}?view=info`);
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
      const payload = {
        ...newMeeting,
        meeting_date: new Date(newMeeting.meeting_date).toISOString() // Convert to ISO for Postgres
      };

      await api.post('/meetings', payload);

      setIsModalOpen(false);
      setNewMeeting({ title: "", meeting_title: "", meeting_date: "", type: "syndicate", status: "draft" });
      mutate();
      toast.success('Meeting created successfully');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to save meeting');
    }
  };

  if (error) return <div className="p-8">Failed to load meetings</div>;
  if (!response) return <div className="p-8">Loading...</div>;

  const allMeetings = response.data || [];

  // At-a-glance attention counts, computed from the full (unfiltered) list.
  const submittedCount = allMeetings.filter(
    (m: any) => (m.approval_status || 'draft') === 'submitted'
  ).length;
  const mySentBackCount = allMeetings.filter(
    (m: any) => m.approval_status === 'sent_back' && isMeetingOwner(user, m)
  ).length;

  const meetings = allMeetings
    .filter((m: any) => typeFilter === 'all' || m.type === typeFilter)
    .filter((m: any) => approvalFilter === 'all' || (m.approval_status || 'draft') === approvalFilter)
    .map((m: any) => {
      const status = (m.approval_status as ApprovalStatus) || 'draft';
      return {
        ...m,
        creator_username: m.creator_username || '—',
        approval_label: (
          <span
            title={status === 'sent_back' && m.review_note ? `Note: ${m.review_note}` : undefined}
            className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full ${APPROVAL_BADGE_CLASSES[status]}`}
          >
            {APPROVAL_LABELS[status]}
          </span>
        ),
      };
    });

  return (
    <div className="max-w-6xl mx-auto">
      <ConfirmModal />

      {/* Moderator/admin: files waiting to be reviewed. */}
      {canReview && submittedCount > 0 && (
        <button
          onClick={() => setApprovalFilter('submitted')}
          className="w-full mb-4 flex items-center gap-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-left text-sm text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
        >
          <Bell className="w-5 h-5 shrink-0" />
          <span>
            <span className="font-semibold">{submittedCount}</span> meeting file{submittedCount > 1 ? 's are' : ' is'} awaiting your review.
            <span className="ml-1 underline">Show them</span>
          </span>
        </button>
      )}

      {/* Initiator: their files that were sent back for corrections. */}
      {isInitiator && mySentBackCount > 0 && (
        <button
          onClick={() => setApprovalFilter('sent_back')}
          className="w-full mb-4 flex items-center gap-3 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-left text-sm text-red-800 dark:text-red-200 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
        >
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>
            <span className="font-semibold">{mySentBackCount}</span> of your file{mySentBackCount > 1 ? 's were' : ' was'} sent back for corrections. Open a file to read the moderator&apos;s note and re-submit.
            <span className="ml-1 underline">Show them</span>
          </span>
        </button>
      )}

      <DataTable
        key={`${typeFilter}-${approvalFilter}`}
        columns={columns}
        data={meetings}
        title="Manage Meetings"
        filters={
          <>
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
            <div className="w-52">
              <CustomSelect
                value={approvalFilter}
                onChange={(val) => setApprovalFilter(val as 'all' | ApprovalStatus)}
                options={[
                  { value: "all", label: "All Approval States" },
                  { value: "draft", label: "Draft" },
                  { value: "submitted", label: "Submitted for review" },
                  { value: "approved", label: "Approved" },
                  { value: "sent_back", label: "Sent back" }
                ]}
              />
            </div>
          </>
        }
        onAdd={canCreateMeeting ? () => {
          setNewMeeting({ title: "", meeting_title: "", meeting_date: "", type: "syndicate", status: "draft" });
          setIsModalOpen(true);
        } : undefined}
        onEdit={handleEdit}
        onDelete={isAdmin ? handleDelete : undefined}
        onView={(meeting) => window.open(`/meetings/${meeting.id}`, '_blank')}
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Type</label>
                  <SearchableSelect
                    options={typeOptions}
                    value={newMeeting.type}
                    onChange={(val) => setNewMeeting({ ...newMeeting, type: val })}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Status</label>
                  <SearchableSelect
                    options={statusOptions}
                    value={newMeeting.status}
                    onChange={(val) => setNewMeeting({ ...newMeeting, status: val })}
                  />
                </div>
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
