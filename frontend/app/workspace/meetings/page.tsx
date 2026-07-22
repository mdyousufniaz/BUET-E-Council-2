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
import { FileJson, Bell, AlertTriangle, Info } from "lucide-react";
import { useAuth } from "../../../hooks/useAuth";
import {
  STAGE_LABELS,
  STAGE_BADGE_CLASSES,
  badgeStage,
  isMeetingOwner,
  type DisplayStage,
} from "../../../lib/meetingAccess";

export default function ManageMeetingsPage() {
  const { canCreateMeeting, isAdmin, isModerator, isInitiator, user } = useAuth();
  const router = useRouter();
  const { data: response, error, mutate } = useSWR('/meetings', fetcher);
  const { confirm, ConfirmModal } = useConfirm();

  const [typeFilter, setTypeFilter] = useState<'all' | 'academic' | 'syndicate'>('all');
  const [stageFilter, setStageFilter] = useState<'all' | DisplayStage>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isJsonModalOpen, setIsJsonModalOpen] = useState(false);

  const [newMeeting, setNewMeeting] = useState({
    title: "",
    meeting_title: "",
    meeting_date: "",
    type: "syndicate",
    status: "draft",
    // Creation-time-only choice — never sent to / stored on the meetings
    // table. Emergency meetings are capped at 1 agendum, enforced later on
    // the Agenda tab via a localStorage flag keyed by the new meeting's id.
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
    { key: "stage_label", label: "Stage", sortable: false },
    { key: "status", label: "Status" },
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
        meeting_date: new Date(newMeeting.meeting_date).toISOString() // Convert to ISO for Postgres
      };

      const res = await api.post('/meetings', payload);

      // Not persisted to the DB by design — stashed client-side so the Agenda
      // tab can enforce "emergency meetings get 1 agendum only" later.
      if (criteria === 'emergency' && res.data?.data?.id) {
        window.localStorage.setItem(`meeting_criteria_${res.data.data.id}`, 'emergency');
      }

      setIsModalOpen(false);
      setNewMeeting({ title: "", meeting_title: "", meeting_date: "", type: "syndicate", status: "draft", criteria: "regular" });
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
  const awaitingAdminCount = allMeetings.filter((m: any) => m.stage === 'admin').length;
  const awaitingModeratorCount = allMeetings.filter((m: any) => m.stage === 'moderator').length;
  const myReturnedCount = allMeetings.filter(
    (m: any) => (m.stage || 'initiator') === 'initiator' && (m.moderator_note || m.admin_note) && isMeetingOwner(user, m)
  ).length;

  const meetings = allMeetings
    .filter((m: any) => typeFilter === 'all' || m.type === typeFilter)
    .filter((m: any) => stageFilter === 'all' || badgeStage(m) === stageFilter)
    .map((m: any) => {
      const shown = badgeStage(m);
      return {
        ...m,
        creator_username: m.creator_username || '—',
        stage_label: (
          <span
            title={m.moderator_note || m.admin_note || undefined}
            className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full ${STAGE_BADGE_CLASSES[shown]}`}
          >
            {STAGE_LABELS[shown]}
          </span>
        ),
      };
    });

  return (
    <div className="max-w-6xl mx-auto">
      <ConfirmModal />

      {/* Admin/superadmin: files escalated and awaiting final approval. */}
      {isAdmin && awaitingAdminCount > 0 && (
        <button
          onClick={() => setStageFilter('admin')}
          className="w-full mb-4 flex items-center gap-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-left text-sm text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
        >
          <Bell className="w-5 h-5 shrink-0" />
          <span>
            <span className="font-semibold">{awaitingAdminCount}</span> meeting file{awaitingAdminCount > 1 ? 's are' : ' is'} awaiting your approval.
            <span className="ml-1 underline">Show them</span>
          </span>
        </button>
      )}

      {/* Moderator: files submitted up to them for review. */}
      {isModerator && awaitingModeratorCount > 0 && (
        <button
          onClick={() => setStageFilter('moderator')}
          className="w-full mb-4 flex items-center gap-3 rounded-lg border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-4 py-3 text-left text-sm text-blue-800 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
        >
          <Bell className="w-5 h-5 shrink-0" />
          <span>
            <span className="font-semibold">{awaitingModeratorCount}</span> meeting file{awaitingModeratorCount > 1 ? 's are' : ' is'} with you for review.
            <span className="ml-1 underline">Show them</span>
          </span>
        </button>
      )}

      {/* Initiator: their files that were handed back for corrections. */}
      {isInitiator && myReturnedCount > 0 && (
        <button
          onClick={() => setStageFilter('initiator')}
          className="w-full mb-4 flex items-center gap-3 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-left text-sm text-red-800 dark:text-red-200 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
        >
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>
            <span className="font-semibold">{myReturnedCount}</span> of your file{myReturnedCount > 1 ? 's were' : ' was'} sent back for corrections. Open a file to read the note and re-submit.
            <span className="ml-1 underline">Show them</span>
          </span>
        </button>
      )}

      <DataTable
        key={`${typeFilter}-${stageFilter}`}
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
                value={stageFilter}
                onChange={(val) => setStageFilter(val as 'all' | DisplayStage)}
                options={
                  // Initiators can't tell moderator from admin, so they get the
                  // single collapsed "forwarded" bucket instead of both.
                  isInitiator
                    ? [
                        { value: "all", label: "All Stages" },
                        { value: "initiator", label: "With me" },
                        { value: "forwarded", label: "Forwarded to moderator" },
                        { value: "approved", label: "Approved" }
                      ]
                    : [
                        { value: "all", label: "All Stages" },
                        { value: "initiator", label: "With initiator" },
                        { value: "moderator", label: "With moderator" },
                        { value: "admin", label: "With admin" },
                        { value: "approved", label: "Approved" }
                      ]
                }
              />
            </div>
          </>
        }
        onAdd={canCreateMeeting ? () => {
          setNewMeeting({ title: "", meeting_title: "", meeting_date: "", type: "syndicate", status: "draft", criteria: "regular" });
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

              <div className="space-y-1">
                <label className="text-xs font-medium">Type</label>
                <SearchableSelect
                  options={typeOptions}
                  value={newMeeting.type}
                  onChange={(val) => setNewMeeting({ ...newMeeting, type: val })}
                />
              </div>
              {/* No status picker: a new file always starts as a draft, and the
                  approval workflow owns the status from then on. */}

              <div className="space-y-1">
                <label className="text-xs font-medium">Meeting Criteria</label>
                <SearchableSelect
                  options={criteriaOptions}
                  value={newMeeting.criteria}
                  onChange={(val) => setNewMeeting({ ...newMeeting, criteria: val })}
                />
              </div>

              {newMeeting.criteria === 'emergency' && (
                <div className="flex items-start gap-2 text-xs text-sky-600 dark:text-sky-400 bg-sky-500/10 rounded-md p-3">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Emergency meetings can only have 1 agendum declared.</span>
                </div>
              )}

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
