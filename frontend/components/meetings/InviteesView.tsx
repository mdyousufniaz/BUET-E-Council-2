"use client";

import { useState } from "react";
import useSWR from "swr";
import api, { fetcher } from "../../lib/api";
import { Mail, Plus, CheckCircle, Clock, Trash2, Users } from "lucide-react";
import SearchableSelect from "../SearchableSelect";
import CustomSelect from "../CustomSelect";
import DataTable from "../DataTable";
import TakeAttendanceView from "./TakeAttendanceView";
import SendAgendaModal from "./SendAgendaModal";

import { toast } from "sonner";
import { useConfirm } from "../../hooks/useConfirm";
import { useAuth } from "../../hooks/useAuth";

export default function InviteesView({ meeting, type, mutate }: { meeting: any, type: string, mutate: any }) {
  const { canEdit } = useAuth();
  const isPast = meeting.status === 'past';
  const displayType = isPast ? 'Presentees' : 'Invitees';
  const isLocked = meeting.is_locked;
  const readOnly = isLocked || !canEdit;

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isAddPresenteeModalOpen, setIsAddPresenteeModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'search' | 'custom'>('search');
  const [isTakingAttendance, setIsTakingAttendance] = useState(false);
  const [isSavingAttendance, setIsSavingAttendance] = useState(false);
  const [isSendAgendaModalOpen, setIsSendAgendaModalOpen] = useState(false);

  const { confirm, ConfirmModal } = useConfirm();
  // TODO: Replace with the actual logged-in user's email from your auth/user
  // context (e.g. a useAuth() hook or a /auth/me call), instead of this stub.
  const currentUserEmail = "you@example.com";


  // Fetch members for the Add Presentee modal
  const { data: membersRes } = useSWR('/members', fetcher);
  const allMembers = membersRes?.data || [];

  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [isSavingPresentees, setIsSavingPresentees] = useState(false);
  const [editingPresentee, setEditingPresentee] = useState<any>(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', designation: '', department_id: '', office_id: '' });
  const [isUpdatingPresentee, setIsUpdatingPresentee] = useState(false);
  const [isCreatingCustom, setIsCreatingCustom] = useState(false);
  const [customForm, setCustomForm] = useState({ name: '', prefix: '', email: '', designation: '', department_id: '', office_id: '' });
  const [isSavingCustom, setIsSavingCustom] = useState(false);

  const { data: departmentsRes } = useSWR('/departments', fetcher);
  const { data: officesRes } = useSWR('/offices', fetcher);
  const departments = departmentsRes?.data || [];
  const offices = officesRes?.data || [];

  // Filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [filterDesignation, setFilterDesignation] = useState("");
  const [filterDepartment, setFilterDepartment] = useState("");
  const [filterOffice, setFilterOffice] = useState("");

  const uniqueDesignations = Array.from(new Set(allMembers.map((m: any) => m.designation).filter(Boolean)));
  const uniqueDepartments = Array.from(new Set(allMembers.map((m: any) => m.department_name).filter(Boolean)));
  const uniqueOffices = Array.from(new Set(allMembers.map((m: any) => m.office_name).filter(Boolean)));

  const filteredMembers = allMembers.filter((m: any) => {
    const matchesSearch = (m.name?.toLowerCase().includes(searchQuery.toLowerCase()) || m.designation?.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesDesignation = filterDesignation ? m.designation === filterDesignation : true;
    const matchesDepartment = filterDepartment ? m.department_name === filterDepartment : true;
    const matchesOffice = filterOffice ? m.office_name === filterOffice : true;
    return matchesSearch && matchesDesignation && matchesDepartment && matchesOffice;
  });

  // Dynamically fetch invitees or presentees
  const fetchUrl = isPast ? `/meetings/${meeting.id}/presentees` : `/meetings/${meeting.id}/invitees`;
  const { data: inviteesRes, mutate: mutateInvitees } = useSWR(fetchUrl, fetcher, { fallbackData: { data: [] } });
  const invitees = inviteesRes?.data || [];

  // Search + filters for the main invitees/presentees table (search handled by DataTable)
  const [tableDesignation, setTableDesignation] = useState("all");
  const [tableDepartment, setTableDepartment] = useState("all");
  const [tableOffice, setTableOffice] = useState("all");

  const inviteeDesignations = Array.from(new Set(invitees.map((m: any) => m.designation).filter(Boolean))).sort() as string[];
  const inviteeDepartments = Array.from(new Set(invitees.map((m: any) => m.department_name).filter(Boolean))).sort() as string[];
  const inviteeOffices = Array.from(new Set(invitees.map((m: any) => m.office_name).filter(Boolean))).sort() as string[];

  const displayedInvitees = invitees.filter((m: any) =>
    (tableDesignation === "all" || m.designation === tableDesignation) &&
    (tableDepartment === "all" || m.department_name === tableDepartment) &&
    (tableOffice === "all" || m.office_name === tableOffice)
  );

  const columns = isPast ? [
    { key: "name", label: "Name" },
    { key: "designation", label: "Designation" },
    { key: "department_name", label: "Department" },
    { key: "office_name", label: "Office" }
  ] : [
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
    confirm("Remove Entry", "Are you sure you want to remove this entry?", async () => {
      try {
        if (isPast) {
            await api.delete(`/meetings/${meeting.id}/presentees/${inviteeId}`);
            mutateInvitees();
            toast.success("Presentee removed successfully");
        } else {
            await api.delete(`/meetings/${meeting.id}/invitees/${inviteeId}`);
            mutateInvitees();
            toast.success("Invitee removed successfully");
        }
      } catch (err) {
        toast.error("Failed to remove");
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

  const handleSaveAttendance = async (presentIds: string[]) => {
    setIsSavingAttendance(true);
    try {
      await api.put(`/meetings/${meeting.id}/attendance`, { present_invitee_ids: presentIds });
      toast.success("Attendance saved successfully");
      setIsTakingAttendance(false);
      mutateInvitees();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to save attendance");
    } finally {
      setIsSavingAttendance(false);
    }
  };

  const handleAddNewOffice = async (officeNameBangla: string, isEdit: boolean = false) => {
    try {
      const res = await api.post('/offices', {
        name_bangla: officeNameBangla,
        name_english: officeNameBangla // fallback
      });
      const newOfficeId = res.data.data.id;
      if (isEdit) {
        setEditForm(prev => ({ ...prev, office_id: newOfficeId }));
      } else {
        setCustomForm(prev => ({ ...prev, office_id: newOfficeId }));
      }
      toast.success('Office added successfully');
    } catch (err: any) {
      toast.error('Failed to add new office');
    }
  };

  const handleAddPresentees = async () => {
    setIsSavingPresentees(true);
    try {
      // Find presentees to remove (they are in invitees but their member.id is NOT in selectedMembers)
      const presenteesToRemove = invitees.filter((p: any) => {
        const matchedMember = allMembers.find((m: any) => p.name === m.name && p.designation === m.designation);
        if (matchedMember) {
          return !selectedMembers.includes(matchedMember.id);
        }
        return false; // don't remove custom presentees that don't match any member
      });

      // Find presentees to add (they are in selectedMembers but NOT in invitees)
      const presenteesToAdd = allMembers
        .filter((m: any) => selectedMembers.includes(m.id))
        .filter((m: any) => !invitees.some((p: any) => p.name === m.name && p.designation === m.designation))
        .map((m: any) => ({
            name: m.name,
            email: m.email || '',
            designation: m.designation,
            department_id: m.department_id,
            office_id: m.office_id
        }));

      // Delete removed ones
      for (const p of presenteesToRemove) {
        if (isPast) {
            await api.delete(`/meetings/${meeting.id}/presentees/${p.id}`);
        } else {
            await api.delete(`/meetings/${meeting.id}/invitees/${p.id}`);
        }
      }

      // Add new ones
      if (presenteesToAdd.length > 0) {
        if (isPast) {
            await api.post(`/meetings/${meeting.id}/presentees`, { presentees: presenteesToAdd });
        } else {
            await api.post(`/meetings/${meeting.id}/invitees`, { invitees: presenteesToAdd });
        }
      }

      toast.success(`${isPast ? 'Presentees' : 'Invitees'} synced successfully`);
      setIsAddPresenteeModalOpen(false);
      mutateInvitees();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to sync presentees");
    } finally {
      setIsSavingPresentees(false);
    }
  };

  const handleCreateCustomPresentee = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingCustom(true);
    try {
      const nameWithPrefix = customForm.prefix ? `${customForm.prefix} ${customForm.name}` : customForm.name;
      const presenteeToAdd = {
        name: nameWithPrefix,
        email: customForm.email,
        designation: customForm.designation,
        department_id: customForm.department_id || null,
        office_id: customForm.office_id || null
      };
      
      if (isPast) {
        await api.post(`/meetings/${meeting.id}/presentees`, { presentees: [presenteeToAdd] });
        toast.success("Custom presentee added successfully");
      } else {
        await api.post(`/meetings/${meeting.id}/invitees`, { invitees: [presenteeToAdd] });
        toast.success("Custom invitee added successfully");
      }
      setIsCreatingCustom(false);
      setIsAddPresenteeModalOpen(false);
      setCustomForm({ name: '', prefix: '', email: '', designation: '', department_id: '', office_id: '' });
      mutateInvitees();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to add custom presentee");
    } finally {
      setIsSavingCustom(false);
    }
  };

  const handleUpdatePresentee = async () => {
    setIsUpdatingPresentee(true);
    try {
      if (isPast) {
        await api.put(`/meetings/${meeting.id}/presentees/${editingPresentee.id}`, editForm);
        toast.success("Presentee updated successfully");
      } else {
        await api.put(`/meetings/${meeting.id}/invitees/${editingPresentee.id}`, editForm);
        toast.success("Invitee updated successfully");
      }
      setEditingPresentee(null);
      mutateInvitees();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to update presentee");
    } finally {
      setIsUpdatingPresentee(false);
    }
  };

  const handleEditClick = (row: any) => {
    setEditingPresentee(row);
    setEditForm({
      name: row.name || '',
      email: row.email || '',
      designation: row.designation || '',
      department_id: row.department_id || '',
      office_id: row.office_id || ''
    });
  };

  if (isTakingAttendance) {
    return (
      <TakeAttendanceView 
        invitees={invitees} 
        onSave={handleSaveAttendance} 
        onCancel={() => setIsTakingAttendance(false)}
        isSaving={isSavingAttendance}
      />
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <ConfirmModal />
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold capitalize">{displayType}</h2>

        <div className="flex items-center gap-4">
          {!isPast ? (
            !readOnly && (
              <>
                <button 
                  onClick={() => setIsTakingAttendance(true)}
                  className="border border-primary text-primary px-4 py-2 text-sm font-medium rounded-md hover:bg-primary/5 transition-colors"
                >
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
                                    <button
                    onClick={() => setIsSendAgendaModalOpen(true)}
                    className="bg-secondary text-secondary-foreground px-4 py-2 text-sm font-medium rounded-md flex items-center gap-2 hover:opacity-90 transition-opacity"
                  >

                    Send Agenda
                  </button>
                  <button
                    onClick={() => {
                      const initiallySelected = allMembers
                        .filter((m: any) => invitees.some((p: any) => p.name === m.name && p.designation === m.designation))
                        .map((m: any) => m.id);
                      setSelectedMembers(initiallySelected);
                      setIsAddPresenteeModalOpen(true);
                    }}
                    className="bg-primary text-primary-foreground px-4 py-2 text-sm font-medium rounded-md flex items-center gap-2 hover:opacity-90 transition-opacity"
                  >
                    <Plus className="w-4 h-4" />
                    Add Invitee
                  </button>
                </div>
              </>
            )
          ) : (
            !readOnly && (
              <button
                onClick={() => {
                  // Initialize selectedMembers with already added presentees
                  const initiallySelected = allMembers
                    .filter((m: any) => invitees.some((p: any) => p.name === m.name && p.designation === m.designation))
                    .map((m: any) => m.id);
                  setSelectedMembers(initiallySelected);
                  setIsAddPresenteeModalOpen(true);
                }}
                className="bg-primary text-primary-foreground px-4 py-2 text-sm font-medium rounded-md flex items-center gap-2 hover:opacity-90 transition-opacity"
              >
                <Plus className="w-4 h-4" />
                Add Presentee
              </button>
            )
          )}
        </div>
      </div>

      {invitees.length === 0 ? (
        <div className="text-center py-16 bg-card border border-border rounded-lg shadow-sm">
          <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-medium text-foreground">No {displayType} added yet</h3>
          <p className="text-muted-foreground mt-1">Click the add button above to include participants.</p>
        </div>
      ) : (
        <DataTable
          key={`${tableDesignation}-${tableDepartment}-${tableOffice}`}
          columns={columns}
          data={displayedInvitees}
          searchable
          searchPlaceholder="Search by name or designation..."
          filters={
            <>
              <div className="w-44">
                <CustomSelect
                  value={tableDesignation}
                  onChange={setTableDesignation}
                  options={[
                    { value: "all", label: "All Designations" },
                    ...inviteeDesignations.map((d) => ({ value: d, label: d }))
                  ]}
                />
              </div>
              <div className="w-44">
                <CustomSelect
                  value={tableDepartment}
                  onChange={setTableDepartment}
                  options={[
                    { value: "all", label: "All Departments" },
                    ...inviteeDepartments.map((d) => ({ value: d, label: d }))
                  ]}
                />
              </div>
              <div className="w-44">
                <CustomSelect
                  value={tableOffice}
                  onChange={setTableOffice}
                  options={[
                    { value: "all", label: "All Offices" },
                    ...inviteeOffices.map((o) => ({ value: o, label: o }))
                  ]}
                />
              </div>
            </>
          }
          onEdit={!readOnly ? handleEditClick : undefined}
          onDelete={!readOnly ? (row) => handleRemove(row.id) : undefined}
        />
      )}

            {/* Send Agenda Modal (Invitees tab + Email tab) */}
      <SendAgendaModal
        isOpen={isSendAgendaModalOpen}
        onClose={() => setIsSendAgendaModalOpen(false)}
        meeting={meeting}
        currentUserEmail={currentUserEmail}
      />



      {/* Add Presentee Modal */}
      {isAddPresenteeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card w-full max-w-2xl max-h-[90vh] rounded-lg shadow-xl border border-border flex flex-col">
            <div className="p-6 border-b border-border flex justify-between items-center shrink-0">
              <h2 className="text-xl font-bold">Add {isPast ? 'Presentees' : 'Invitees'}</h2>
              <button onClick={() => setIsAddPresenteeModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                &times;
              </button>
            </div>
            <div className="p-4 border-b border-border flex flex-col gap-3 shrink-0 bg-muted/20">
              <input 
                type="text" 
                placeholder="Search by name or designation..." 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full px-3 py-2 bg-input/20 border border-input rounded-md text-sm"
              />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <SearchableSelect 
                  options={[
                    { value: "", label: "All Designations" },
                    ...uniqueDesignations.map((des: any) => ({ value: des, label: des }))
                  ]}
                  value={filterDesignation} 
                  onChange={setFilterDesignation}
                  placeholder="Filter Designation"
                />
                <SearchableSelect 
                  options={[
                    { value: "", label: "All Departments" },
                    ...uniqueDepartments.map((dep: any) => ({ value: dep, label: dep }))
                  ]}
                  value={filterDepartment} 
                  onChange={setFilterDepartment}
                  placeholder="Filter Department"
                />
                <SearchableSelect 
                  options={[
                    { value: "", label: "All Offices" },
                    ...uniqueOffices.map((off: any) => ({ value: off, label: off }))
                  ]}
                  value={filterOffice} 
                  onChange={setFilterOffice}
                  placeholder="Filter Office"
                />
              </div>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <div className="space-y-2">
                {filteredMembers.map((member: any) => {
                  const isAlreadyAdded = invitees.some((p: any) => p.name === member.name && p.designation === member.designation);
                  return (
                    <label key={member.id} className={`flex items-center gap-3 p-3 rounded-md border border-border ${isAlreadyAdded ? 'bg-muted/10' : 'hover:bg-muted/30'} cursor-pointer`}>
                      <input 
                        type="checkbox" 
                        className="w-4 h-4 rounded border-input"
                        checked={selectedMembers.includes(member.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedMembers(prev => [...prev, member.id]);
                          } else {
                            setSelectedMembers(prev => prev.filter(id => id !== member.id));
                          }
                        }}
                      />
                      <div>
                        <div className="font-medium text-sm flex items-center gap-2">
                          {member.name}
                          {isAlreadyAdded && <span className="text-[10px] uppercase font-bold tracking-wider bg-primary/10 text-primary px-1.5 py-0.5 rounded">Added</span>}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {member.designation} 
                          {member.department_name ? ` • ${member.department_name}` : ''}
                          {member.office_name ? ` • ${member.office_name}` : ''}
                        </div>
                      </div>
                    </label>
                  );
                })}
                {filteredMembers.length === 0 && (
                  <div className="text-center text-sm text-muted-foreground py-8">
                    <p className="mb-4">No members match the filters.</p>
                    <button 
                      onClick={() => setIsCreatingCustom(true)}
                      className="bg-primary text-primary-foreground px-4 py-2 rounded-md font-medium text-sm hover:opacity-90 transition-opacity flex items-center gap-2 mx-auto"
                    >
                      <Plus className="w-4 h-4" /> Create Custom {isPast ? 'Presentee' : 'Invitee'}
                    </button>
                  </div>
                )}
              </div>
            </div>
            {filteredMembers.length > 0 && (
              <div className="p-6 border-t border-border shrink-0 flex justify-between items-center gap-3">
                <button 
                  onClick={() => setIsCreatingCustom(true)}
                  className="text-sm font-medium text-primary hover:underline flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" /> Create Custom
                </button>
                <div className="flex gap-3">
                  <button 
                    onClick={() => setIsAddPresenteeModalOpen(false)} 
                    className="px-4 py-2 text-sm bg-muted text-muted-foreground rounded-md hover:bg-muted/80"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleAddPresentees}
                    disabled={isSavingPresentees || selectedMembers.length === 0}
                    className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50"
                  >
                    {isSavingPresentees ? "Adding..." : `Add Selected (${selectedMembers.length})`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Custom {isPast ? 'Presentee' : 'Invitee'} Modal */}
      {isCreatingCustom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card w-full max-w-lg rounded-lg shadow-xl border border-border p-6 relative max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">Create Custom {isPast ? 'Presentee' : 'Invitee'}</h3>
            <form onSubmit={handleCreateCustomPresentee} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Name</label>
                  <input 
                    required
                    type="text" 
                    value={customForm.name}
                    onChange={(e) => setCustomForm(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Prefix</label>
                  <input 
                    type="text" 
                    value={customForm.prefix}
                    onChange={(e) => setCustomForm(prev => ({ ...prev, prefix: e.target.value }))}
                    className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm"
                  />
                </div>
              </div>
              
              <div className="space-y-1">
                <label className="text-xs font-medium">Email (for Invitees)</label>
                <input 
                  type="email" 
                  value={customForm.email}
                  onChange={(e) => setCustomForm(prev => ({ ...prev, email: e.target.value }))}
                  className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium">Designation</label>
                <SearchableSelect 
                  options={[
                    { value: "", label: "None" },
                    { value: "অধ্যাপক", label: "অধ্যাপক" },
                    { value: "সহযোগী অধ্যাপক", label: "সহযোগী অধ্যাপক" },
                  ]}
                  value={customForm.designation}
                  onChange={(val) => setCustomForm(prev => ({ ...prev, designation: val }))}
                  placeholder="Select Designation..."
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium">Department</label>
                <SearchableSelect
                  options={[{ value: "", label: "None" }, ...departments.map((d: any) => ({ value: d.id, label: d.name_bangla }))]}
                  value={customForm.department_id || ''}
                  onChange={(val) => setCustomForm(prev => ({ ...prev, department_id: val }))}
                  placeholder="Select Department..."
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium">Office (Bangla)</label>
                <SearchableSelect
                  options={[{ value: "", label: "None" }, ...offices.map((o: any) => ({ value: o.id, label: o.name_bangla }))]}
                  value={customForm.office_id || ''}
                  onChange={(val) => setCustomForm(prev => ({ ...prev, office_id: val }))}
                  onAddNew={handleAddNewOffice}
                  placeholder="Search Office or add new..."
                />
              </div>
              <div className="pt-6 shrink-0 flex justify-end gap-3">
                <button 
                  type="button"
                  onClick={() => setIsCreatingCustom(false)} 
                  className="px-4 py-2 text-sm bg-muted text-muted-foreground rounded-md hover:bg-muted/80"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={isSavingCustom || !customForm.name}
                  className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50"
                >
                  {isSavingCustom ? "Saving..." : "Create & Add"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Presentee Modal */}
      {editingPresentee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card w-full max-w-lg rounded-lg shadow-xl border border-border p-6 relative max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">Edit {isPast ? 'Presentee' : 'Invitee'}</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Name</label>
                  <input 
                    required
                    type="text" 
                    value={editForm.name}
                    onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm"
                  />
                </div>
                {!isPast && (
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Email</label>
                    <input 
                      type="email" 
                      value={editForm.email}
                      onChange={(e) => setEditForm(prev => ({ ...prev, email: e.target.value }))}
                      className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm"
                    />
                  </div>
                )}
                <div className="space-y-1">
                  <label className="text-xs font-medium">Designation</label>
                  <SearchableSelect 
                    options={[
                      { value: "", label: "None" },
                      { value: "অধ্যাপক", label: "অধ্যাপক" },
                      { value: "সহযোগী অধ্যাপক", label: "সহযোগী অধ্যাপক" },
                    ]}
                    value={editForm.designation}
                    onChange={(val) => setEditForm(prev => ({ ...prev, designation: val }))}
                    placeholder="Select Designation..."
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Department</label>
                <SearchableSelect
                  options={[{ value: "", label: "None" }, ...departments.map((d: any) => ({ value: d.id, label: d.name_bangla }))]}
                  value={editForm.department_id || ''}
                  onChange={(val) => setEditForm(prev => ({ ...prev, department_id: val }))}
                  placeholder="Select Department..."
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium">Office (Bangla)</label>
                <SearchableSelect
                  options={[{ value: "", label: "None" }, ...offices.map((o: any) => ({ value: o.id, label: o.name_bangla }))]}
                  value={editForm.office_id || ''}
                  onChange={(val) => setEditForm(prev => ({ ...prev, office_id: val }))}
                  onAddNew={(val) => handleAddNewOffice(val, true)}
                  placeholder="Search Office or add new..."
                />
              </div>
            </div>
            <div className="pt-6 shrink-0 flex justify-end gap-3">
              <button 
                onClick={() => setEditingPresentee(null)} 
                className="px-4 py-2 text-sm bg-muted text-muted-foreground rounded-md hover:bg-muted/80"
              >
                Cancel
              </button>
              <button 
                onClick={handleUpdatePresentee}
                disabled={isUpdatingPresentee || !editForm.name}
                className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50"
              >
                {isUpdatingPresentee ? "Saving..." : "Save Changes"}
              </button>
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
