"use client";

import { useState } from "react";
import useSWR from "swr";
import api, { fetcher } from "../../lib/api";
import { Mail, Plus, CheckCircle, Clock, Trash2, Users } from "lucide-react";
import SearchableSelect from "../SearchableSelect";
import DataTable from "../DataTable";
import { toast } from "sonner";
import { useConfirm } from "../../hooks/useConfirm";

export default function InviteesView({ meeting, type, mutate }: { meeting: any, type: string, mutate: any }) {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'search' | 'custom'>('search');
  const { confirm, ConfirmModal } = useConfirm();
  
  // This would fetch actual invitees for this meeting
  // For now we will mock it or leave it empty if the API is not fully set up for fetching invitees
  const { data: inviteesRes, mutate: mutateInvitees } = useSWR(`/meetings/${meeting.id}/invitees`, fetcher, { fallbackData: { data: [] } });
  const invitees = inviteesRes?.data || [];

  const columns = [
    { key: "name", label: "Name" },
    { key: "designation", label: "Designation" },
    { key: "department_name", label: "Department" },
    { key: "office_name", label: "Office" },
    { 
      key: "email_sent", 
      label: "Agenda Sent",
      render: (val: any) => val ? (
        <span className="inline-flex items-center gap-1 bg-accent text-accent-foreground px-2 py-0.5 rounded-full text-xs font-medium">
          <CheckCircle className="w-3 h-3" /> Sent
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 bg-muted text-muted-foreground px-2 py-0.5 rounded-full text-xs font-medium">
          <Clock className="w-3 h-3" /> Not Sent
        </span>
      )
    }
  ];

  const [isFetching, setIsFetching] = useState(false);

  const handleRemove = (inviteeId: string) => {
    confirm("Remove Invitee", "Are you sure you want to remove this invitee?", async () => {
      try {
        await api.delete(`/meetings/${meeting.id}/invitees/${inviteeId}`);
        mutateInvitees();
        toast.success("Invitee removed successfully");
      } catch (err) {
        toast.error("Failed to remove invitee");
      }
    });
  };

  const handleBulkFetch = () => {
    confirm("Fetch Members", `Are you sure you want to fetch all ${meeting.type} members into this meeting's invitee list?`, async () => {
      setIsFetching(true);
      try {
        const res = await api.post(`/meetings/${meeting.id}/invitees/bulk-fetch`);
        toast.success(res.data.message || "Members fetched successfully");
        mutateInvitees();
      } catch (err: any) {
        toast.error(err.response?.data?.message || "Failed to fetch members");
      } finally {
        setIsFetching(false);
      }
    });
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <ConfirmModal />
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold capitalize">{type}</h2>
        
        <div className="flex items-center gap-4">
          <button className="border border-primary text-primary px-4 py-2 text-sm font-medium rounded-md hover:bg-primary/5 transition-colors">
            Take Attendance
          </button>
          <div className="flex gap-2">
            <button 
              onClick={handleBulkFetch}
              disabled={isFetching}
              className="bg-accent text-accent-foreground border border-border px-4 py-2 text-sm font-medium rounded-md flex items-center gap-2 hover:bg-accent/80 transition-opacity disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              {isFetching ? "Fetching..." : "Fetch From Members"}
            </button>
            <button className="bg-secondary text-secondary-foreground px-4 py-2 text-sm font-medium rounded-md flex items-center gap-2 hover:opacity-90 transition-opacity">
              <Mail className="w-4 h-4" />
              Send Agenda
            </button>
            <button 
              onClick={() => setIsAddModalOpen(true)}
              className="bg-primary text-primary-foreground px-4 py-2 text-sm font-medium rounded-md flex items-center gap-2 hover:opacity-90 transition-opacity"
            >
              <Plus className="w-4 h-4" />
              Add {type === 'president' ? 'President' : 'Invitee'}
            </button>
          </div>
        </div>
      </div>

      {invitees.length === 0 ? (
        <div className="text-center py-16 bg-card border border-border rounded-lg shadow-sm">
          <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-medium text-foreground">No {type} added yet</h3>
          <p className="text-muted-foreground mt-1">Click the add button above to include participants.</p>
        </div>
      ) : (
        <DataTable 
          columns={columns} 
          data={invitees} 
          title="Invitees List" 
          onDelete={(row) => handleRemove(row.id)}
        />
      )}

      {/* Add Modal Placeholder */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card w-full max-w-lg rounded-lg shadow-xl border border-border overflow-hidden">
            <div className="flex border-b border-border">
              <button 
                className={`flex-1 py-3 text-sm font-medium ${activeTab === 'search' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted/50'}`}
                onClick={() => setActiveTab('search')}
              >
                Search Members
              </button>
              <button 
                className={`flex-1 py-3 text-sm font-medium ${activeTab === 'custom' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted/50'}`}
                onClick={() => setActiveTab('custom')}
              >
                Create Custom
              </button>
            </div>
            
            <div className="p-6">
              {activeTab === 'search' ? (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">Search and select an existing member from the database.</p>
                  <SearchableSelect options={[]} value="" onChange={() => {}} placeholder="Search members by name..." />
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">Add an external guest manually.</p>
                  <input placeholder="Full Name" className="w-full px-3 py-2 bg-input/20 border border-input rounded-md text-sm" />
                  <input placeholder="Email Address" type="email" className="w-full px-3 py-2 bg-input/20 border border-input rounded-md text-sm" />
                  <input placeholder="Designation" className="w-full px-3 py-2 bg-input/20 border border-input rounded-md text-sm" />
                </div>
              )}
              
              <div className="flex justify-end gap-2 mt-6">
                <button onClick={() => setIsAddModalOpen(false)} className="px-4 py-2 text-sm bg-muted text-muted-foreground rounded-md hover:bg-muted/80">Cancel</button>
                <button className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90">Add to Meeting</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function UsersIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}
