"use client";

import { useState, useMemo } from "react";
import useSWR from "swr";
import api, { fetcher } from "../../lib/api";
import { Mail, Plus, CheckCircle, Clock, Trash2, Users, ShieldCheck, Building, Check, X, ChevronDown, LayoutList, Layers, Pencil } from "lucide-react";
import SearchableSelect from "../SearchableSelect";
import CustomSelect from "../CustomSelect";
import DataTable from "../DataTable";
import TakeAttendanceView from "./TakeAttendanceView";
import SendAgendaModal from "./SendAgendaModal";

import { toast } from "sonner";
import { useConfirm } from "../../hooks/useConfirm";
import { useAuth } from "../../hooks/useAuth";
import { canOperateMeeting, canEditResolution } from "../../lib/meetingAccess";

export default function InviteesView({ meeting, type, mutate }: { meeting: any, type: string, mutate: any }) {
  const { user } = useAuth();
  const canEdit = canOperateMeeting(user, meeting);
  // Attendance belongs to the resolution phase (approved + ongoing), which
  // opens for the initiator/moderator even though agenda editing is locked.
  const canAttendance = canEditResolution(user, meeting);
  const isPast = meeting.status === 'past';
  const displayType = isPast ? 'Presentees' : 'Invitees';
  const readOnly = !canEdit;

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isAddPresenteeModalOpen, setIsAddPresenteeModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'search' | 'custom'>('search');
  const [isTakingAttendance, setIsTakingAttendance] = useState(false);
  const [isSavingAttendance, setIsSavingAttendance] = useState(false);
  const [isSendAgendaModalOpen, setIsSendAgendaModalOpen] = useState(false);
  const [isBulkDeleteMode, setIsBulkDeleteMode] = useState(false);
  const [selectedInviteeIds, setSelectedInviteeIds] = useState<Set<string>>(new Set());
  const [inviteeViewMode, setInviteeViewMode] = useState<'list' | 'grouped'>('list');
  const [collapsedInviteeGroups, setCollapsedInviteeGroups] = useState<Set<string>>(new Set());

  const { confirm, ConfirmModal } = useConfirm();
  const currentUserEmail = user?.email || "";


  // Fetch members for the Add Presentee modal
  const { data: membersRes } = useSWR('/members', fetcher);
  const allMembers = membersRes?.data || [];

  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [isSavingPresentees, setIsSavingPresentees] = useState(false);
  const [editingPresentee, setEditingPresentee] = useState<any>(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', designation: '', department_id: '', office_id: '' });
  const [isUpdatingPresentee, setIsUpdatingPresentee] = useState(false);
  const [isCreatingCustom, setIsCreatingCustom] = useState(false);
  const [customForm, setCustomForm] = useState({ name: '', prefix: '', serial: '', email: '', designation: '', department_id: '', office_id: '' });
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

  // Group the (already-filtered) member picker list the same way the public
  // meeting view and the agenda/resolution PDF do — প্রশাসন (VC & Pro-VC),
  // সকল ডিন, সকল বিভাগীয় প্রধান, then departments sorted by seniority, then
  // অন্যান্য সদস্য — so the 3 filters above narrow the pool and grouping just
  // organizes whatever's left (an empty group simply doesn't render).
  const departmentSerialMap: Record<string, number> = {};
  departments.forEach((d: any) => { departmentSerialMap[d.id] = d.serial; });

  const isVCMember = (m: any) => {
    const des = (m.designation || '').toLowerCase();
    const office = (m.office_name || '').toLowerCase();
    return (des.includes('উপাচার্য') || office.includes('উপাচার্য')) && !(des.includes('উপ-উপাচার্য') || office.includes('উপ-উপাচার্য'));
  };
  const isProVCMember = (m: any) => {
    const des = (m.designation || '').toLowerCase();
    const office = (m.office_name || '').toLowerCase();
    return des.includes('উপ-উপাচার্য') || office.includes('উপ-উপাচার্য');
  };
  const isDeanMember = (m: any) => {
    const des = (m.designation || '').toLowerCase();
    const office = (m.office_name || '').toLowerCase();
    return office.includes('ডিন') || office.includes('dean') || des.includes('ডিন') || des.includes('dean');
  };
  const isHeadMember = (m: any) => (m.office_name || '').toLowerCase().includes('বিভাগীয় প্রধান');

  const adminMembers: any[] = [];
  const deanMembers: any[] = [];
  const headMembers: any[] = [];
  const memberDeptGroups: Record<string, { serial: number, members: any[] }> = {};
  const otherMembers: any[] = [];

  filteredMembers.forEach((m: any) => {
    if (isVCMember(m)) {
      adminMembers.unshift(m);
    } else if (isProVCMember(m)) {
      adminMembers.push(m);
    } else if (isDeanMember(m)) {
      deanMembers.push(m);
    } else if (isHeadMember(m)) {
      headMembers.push(m);
    } else if (m.department_name) {
      if (!memberDeptGroups[m.department_name]) {
        memberDeptGroups[m.department_name] = { serial: departmentSerialMap[m.department_id] ?? 9999, members: [] };
      }
      memberDeptGroups[m.department_name].members.push(m);
    } else {
      otherMembers.push(m);
    }
  });

  const sortedMemberDeptGroups = Object.entries(memberDeptGroups).sort(([, a], [, b]) => a.serial - b.serial);

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

  // Grid-view grouping — mirrors the categorization used for the Add
  // Invitee/Presentee member picker (VC/Pro-VC, Deans, Dept Heads, then
  // departments sorted by seniority, then everyone else).
  const isInviteeVC = (m: any) => {
    const des = (m.designation || '').toLowerCase();
    const office = (m.office_name || '').toLowerCase();
    return (des.includes('উপাচার্য') || office.includes('উপাচার্য')) && !(des.includes('উপ-উপাচার্য') || office.includes('উপ-উপাচার্য'));
  };
  const isInviteeProVC = (m: any) => {
    const des = (m.designation || '').toLowerCase();
    const office = (m.office_name || '').toLowerCase();
    return des.includes('উপ-উপাচার্য') || office.includes('উপ-উপাচার্য');
  };
  const isInviteeDean = (m: any) => {
    const des = (m.designation || '').toLowerCase();
    const office = (m.office_name || '').toLowerCase();
    return office.includes('ডিন') || office.includes('dean') || des.includes('ডিন') || des.includes('dean');
  };
  const isInviteeHead = (m: any) => (m.office_name || '').toLowerCase().includes('বিভাগীয় প্রধান');

  const inviteeGroups = useMemo(() => {
    const admin: any[] = [];
    const deans: any[] = [];
    const heads: any[] = [];
    const deptGroups: Record<string, { serial: number, members: any[] }> = {};
    const others: any[] = [];

    displayedInvitees.forEach((m: any) => {
      if (isInviteeVC(m)) admin.unshift(m);
      else if (isInviteeProVC(m)) admin.push(m);
      else if (isInviteeDean(m)) deans.push(m);
      else if (isInviteeHead(m)) heads.push(m);
      else if (m.department_name) {
        if (!deptGroups[m.department_name]) {
          deptGroups[m.department_name] = { serial: m.department_serial ?? 9999, members: [] };
        }
        deptGroups[m.department_name].members.push(m);
      } else {
        others.push(m);
      }
    });

    const sortedDeptGroups = Object.entries(deptGroups).sort(([, a], [, b]) => a.serial - b.serial);
    return { admin, deans, heads, sortedDeptGroups, others };
  }, [displayedInvitees]);

  const toggleInviteeGroupCollapse = (key: string) => {
    setCollapsedInviteeGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const renderInviteeGroup = (key: string, title: string, members: any[], icon: React.ReactNode) => {
    if (members.length === 0) return null;
    const isCollapsed = collapsedInviteeGroups.has(key);
    const isGroupAllSelected = isBulkDeleteMode && members.length > 0 && members.every(m => selectedInviteeIds.has(m.id));
    const isGroupIndeterminate = isBulkDeleteMode && !isGroupAllSelected && members.some(m => selectedInviteeIds.has(m.id));

    return (
      <div key={key} className="mb-4 bg-card border border-border rounded-lg overflow-hidden shadow-sm">
        <div
          onClick={() => toggleInviteeGroupCollapse(key)}
          className="w-full bg-muted/50 px-4 py-3 flex items-center justify-between border-b border-border hover:bg-muted transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2">
            {icon}
            <h3 className="font-semibold text-foreground">{title}</h3>
            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
              {members.length}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {isBulkDeleteMode && (
              <label
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground cursor-pointer select-none"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={isGroupAllSelected}
                  ref={el => { if (el) el.indeterminate = isGroupIndeterminate; }}
                  onChange={() => handleToggleSelectAllInvitees(members.map(m => m.id), !isGroupAllSelected)}
                  className="cursor-pointer"
                />
                Select All
              </label>
            )}
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
          </div>
        </div>
        {!isCollapsed && (
          <div className="divide-y divide-border">
            {members.map((m: any) => (
              <div
                key={m.id}
                onClick={() => isBulkDeleteMode && handleToggleSelectInvitee(m.id)}
                className={`flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors group ${isBulkDeleteMode ? 'cursor-pointer' : ''}`}
              >
                <div className="flex items-center gap-3">
                  {isBulkDeleteMode && (
                    <input
                      type="checkbox"
                      checked={selectedInviteeIds.has(m.id)}
                      onChange={() => handleToggleSelectInvitee(m.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="cursor-pointer"
                    />
                  )}
                  <div>
                    <div className="font-medium text-foreground">{m.name}</div>
                    <div className="text-sm text-muted-foreground flex items-center gap-2 mt-0.5">
                      {m.designation && <span>{m.designation}</span>}
                      {m.office_name && (
                        <>
                          <span className="w-1 h-1 rounded-full bg-border" />
                          <span>{m.office_name}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                {!readOnly && !isBulkDeleteMode && (
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleEditClick(m); }}
                      className="p-1 text-muted-foreground hover:text-primary transition-colors"
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRemove(m.id); }}
                      className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // Drag-reorder derives a target serial from the dragged row's new neighbors
  // in this list, so it's only safe while the list isn't narrowed by a filter
  // — otherwise the "neighbor" wouldn't be the true adjacent invitee.
  const noTableFiltersActive = tableDesignation === "all" && tableDepartment === "all" && tableOffice === "all";

  const columns = isPast ? [
    { key: "serial", label: "Serial No" },
    { key: "name", label: "Name" },
    { key: "designation", label: "Designation" },
    { key: "department_name", label: "Department" },
    { key: "office_name", label: "Office" }
  ] : [
    { key: "serial", label: "Serial No" },
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

  const handleToggleSelectInvitee = (id: string) => {
    setSelectedInviteeIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleToggleSelectAllInvitees = (visibleIds: string[], selectAll: boolean) => {
    setSelectedInviteeIds(prev => {
      const next = new Set(prev);
      visibleIds.forEach(id => selectAll ? next.add(id) : next.delete(id));
      return next;
    });
  };

  const handleCancelBulkDelete = () => {
    setIsBulkDeleteMode(false);
    setSelectedInviteeIds(new Set());
  };

  const handleBulkDelete = () => {
    if (selectedInviteeIds.size === 0) {
      toast.error(`Select at least one ${isPast ? 'presentee' : 'invitee'} to delete`);
      return;
    }
    const ids = Array.from(selectedInviteeIds);
    const count = ids.length;
    confirm(
      `Remove ${count} ${isPast ? 'Presentee' : 'Invitee'}${count > 1 ? 's' : ''}`,
      `Are you sure you want to remove ${count} selected ${isPast ? 'presentee' : 'invitee'}${count > 1 ? 's' : ''}?`,
      async () => {
        try {
          await Promise.all(
            ids.map(id => isPast
              ? api.delete(`/meetings/${meeting.id}/presentees/${id}`)
              : api.delete(`/meetings/${meeting.id}/invitees/${id}`)
            )
          );
          mutateInvitees();
          toast.success(`${count} ${isPast ? 'presentee' : 'invitee'}${count > 1 ? 's' : ''} removed successfully`);
        } catch (err) {
          toast.error("Failed to remove selected entries");
        } finally {
          setIsBulkDeleteMode(false);
          setSelectedInviteeIds(new Set());
        }
      }
    );
  };

  const handleReorderInvitee = async (sourceIndex: number, targetIndex: number) => {
    const movedInvitee = displayedInvitees[sourceIndex];
    if (!movedInvitee) return;

    // Neighbors in the post-move arrangement (list with the moved row taken
    // out first, since that's how DataTable computes targetIndex).
    const withoutMoved = displayedInvitees.filter((_: any, i: number) => i !== sourceIndex);
    const nextInvitee = withoutMoved[targetIndex];
    const prevInvitee = withoutMoved[targetIndex - 1];

    let targetSerial: number;
    if (nextInvitee) {
      targetSerial = nextInvitee.serial;
    } else if (prevInvitee) {
      targetSerial = (prevInvitee.serial ?? 0) + 1;
    } else {
      targetSerial = 1;
    }

    try {
      await api.put(`/meetings/${meeting.id}/invitees/${movedInvitee.id}/reorder`, { serial: targetSerial });
      mutateInvitees();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to reorder invitee");
    }
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
            office_id: m.office_id,
            member_id: m.id
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

      const label = isPast ? 'presentee' : 'invitee';
      const addedCount = presenteesToAdd.length;
      const removedCount = presenteesToRemove.length;
      const plural = (n: number) => `${n} ${label}${n === 1 ? '' : 's'}`;

      if (addedCount > 0 && removedCount === 0) {
        toast.success(`${plural(addedCount)} added successfully`);
      } else if (removedCount > 0 && addedCount === 0) {
        toast.success(`${plural(removedCount)} removed successfully`);
      } else {
        toast.success(`${isPast ? 'Presentees' : 'Invitees'} updated successfully`);
      }
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
        serial: customForm.serial,
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
      setCustomForm({ name: '', prefix: '', serial: '', email: '', designation: '', department_id: '', office_id: '' });
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

  const renderMemberGroup = (title: string, members: any[], icon: React.ReactNode) => {
    if (members.length === 0) return null;
    return (
      <div key={title} className="space-y-2">
        <div className="flex items-center gap-2 pt-2 first:pt-0">
          {icon}
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
          <span className="text-xs text-muted-foreground">({members.length})</span>
        </div>
        {members.map((member: any) => {
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
      </div>
    );
  };

  const bulkDeleteControls = !readOnly && invitees.length > 0 && (
    isBulkDeleteMode ? (
      <div className="flex items-center gap-2">
        <button
          onClick={handleBulkDelete}
          title="Confirm delete"
          className="p-2 bg-destructive text-destructive-foreground rounded-md hover:opacity-90 transition-opacity"
        >
          <Check className="w-4 h-4" />
        </button>
        <button
          onClick={handleCancelBulkDelete}
          title="Cancel"
          className="p-2 bg-accent text-accent-foreground border border-border rounded-md hover:bg-accent/80 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    ) : (
      <button
        onClick={() => setIsBulkDeleteMode(true)}
        className="border border-destructive/50 text-destructive px-4 py-2 text-sm font-medium rounded-md flex items-center gap-2 hover:bg-destructive/5 transition-colors"
      >
        <Trash2 className="w-4 h-4" />
        Delete {isPast ? 'Presentee' : 'Invitee'}
      </button>
    )
  );

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
            <>
              {canAttendance && (
                <button
                  onClick={() => setIsTakingAttendance(true)}
                  className="border border-primary text-primary px-4 py-2 text-sm font-medium rounded-md hover:bg-primary/5 transition-colors"
                >
                  Take Attendance
                </button>
              )}
              {!readOnly && (
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
                  {bulkDeleteControls}
                </div>
              )}
            </>
          ) : (
            !readOnly && (
              <div className="flex gap-2">
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
                {bulkDeleteControls}
              </div>
            )
          )}
        </div>
      </div>

      {invitees.length > 0 && (
        <div className="flex justify-end mb-4">
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            <button
              onClick={() => setInviteeViewMode('list')}
              className={`px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 transition-colors ${inviteeViewMode === 'list' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-accent'}`}
            >
              <LayoutList className="w-4 h-4" /> List
            </button>
            <button
              onClick={() => setInviteeViewMode('grouped')}
              className={`px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 transition-colors border-l border-border ${inviteeViewMode === 'grouped' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-accent'}`}
            >
              <Layers className="w-4 h-4" /> Grouped
            </button>
          </div>
        </div>
      )}

      {invitees.length === 0 ? (
        <div className="text-center py-16 bg-card border border-border rounded-lg shadow-sm">
          <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-medium text-foreground">No {displayType} added yet</h3>
          <p className="text-muted-foreground mt-1">Click the add button above to include participants.</p>
        </div>
      ) : inviteeViewMode === 'grouped' ? (
        <div>
          {renderInviteeGroup('admin', 'প্রশাসন', inviteeGroups.admin, <ShieldCheck className="w-4 h-4 text-primary" />)}
          {renderInviteeGroup('deans', 'সকল ডিন', inviteeGroups.deans, <Building className="w-4 h-4 text-blue-500" />)}
          {renderInviteeGroup('heads', 'সকল বিভাগীয় প্রধান', inviteeGroups.heads, <Building className="w-4 h-4 text-blue-500" />)}
          {inviteeGroups.sortedDeptGroups.map(([deptName, data]) => renderInviteeGroup(`dept-${deptName}`, deptName, data.members, <Building className="w-4 h-4 text-blue-500" />))}
          {renderInviteeGroup('others', 'অন্যান্য সদস্য', inviteeGroups.others, <Users className="w-4 h-4 text-muted-foreground" />)}
        </div>
      ) : (
        <DataTable
          key={`${tableDesignation}-${tableDepartment}-${tableOffice}`}
          columns={columns}
          data={displayedInvitees}
          searchable
          searchPlaceholder="Search by name or designation..."
          onReorderItem={!isPast && !readOnly && noTableFiltersActive ? handleReorderInvitee : undefined}
          selectable={isBulkDeleteMode}
          selectedIds={selectedInviteeIds}
          onToggleSelect={handleToggleSelectInvitee}
          onToggleSelectAll={handleToggleSelectAllInvitees}
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
              <div className="space-y-4">
                {renderMemberGroup('প্রশাসন', adminMembers, <ShieldCheck className="w-4 h-4 text-primary" />)}
                {renderMemberGroup('সকল ডিন', deanMembers, <Building className="w-4 h-4 text-blue-500" />)}
                {renderMemberGroup('সকল বিভাগীয় প্রধান', headMembers, <Building className="w-4 h-4 text-blue-500" />)}
                {sortedMemberDeptGroups.map(([deptName, data]) => renderMemberGroup(deptName, data.members, <Building className="w-4 h-4 text-blue-500" />))}
                {renderMemberGroup('অন্যান্য সদস্য', otherMembers, <Users className="w-4 h-4 text-muted-foreground" />)}
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Prefix</label>
                  <input
                    type="text"
                    value={customForm.prefix}
                    onChange={(e) => setCustomForm(prev => ({ ...prev, prefix: e.target.value }))}
                    className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Serial No (optional)</label>
                  <input
                    type="number"
                    min={1}
                    value={customForm.serial}
                    onChange={(e) => setCustomForm(prev => ({ ...prev, serial: e.target.value }))}
                    placeholder="Add at the end"
                    className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground -mt-2">If the chosen serial is already taken, other custom entries from that serial onward shift down by one.</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
