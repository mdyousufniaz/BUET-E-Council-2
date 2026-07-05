"use client";

import { useState } from "react";
import useSWR from "swr";
import api, { fetcher } from "../../../lib/api";
import DataTable from "../../../components/DataTable";
import SearchableSelect from "../../../components/SearchableSelect";
import CustomSelect from "../../../components/CustomSelect";
import { toast } from "sonner";
import { useConfirm } from "../../../hooks/useConfirm";

export default function ManageMembersPage() {
  const [designationFilter, setDesignationFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [officeFilter, setOfficeFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const { data: response, error, mutate } = useSWR('/members', fetcher);
  const { confirm, ConfirmModal } = useConfirm();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newMember, setNewMember] = useState({
    name: "",
    prefix: "",
    designation: "",
    department_id: "",
    office_id: "",
    email: "",
    member_type: "academic"
  });

  // Fetch departments and offices for the dropdowns
  const { data: deptRes } = useSWR('/departments', fetcher);
  const { data: officeRes } = useSWR('/offices', fetcher);

  const departments = [{ value: "", label: "None" }, ...(deptRes?.data?.map((d: any) => ({ value: d.id, label: d.name_bangla })) || [])];
  const offices = [{ value: "", label: "None" }, ...(officeRes?.data?.map((o: any) => ({ value: o.id, label: o.name_bangla })) || [])];

  // Derive filter options and apply Designation/Department filters client-side.
  const allMembers = response?.data || [];
  const designationOptions: string[] = Array.from(
    new Set(allMembers.map((m: any) => m.designation).filter(Boolean))
  ).sort() as string[];

  const displayedMembers = allMembers.filter((m: any) =>
    (designationFilter === "all" || m.designation === designationFilter) &&
    (departmentFilter === "all" || m.department_id === departmentFilter) &&
    (officeFilter === "all" || m.office_id === officeFilter) &&
    (typeFilter === "all" || m.member_type === typeFilter)
  );

  const columns = [
    { key: "serial", label: "Serial No" },
    { key: "name", label: "Name" },
    { key: "designation", label: "Designation" },
    { key: "department_name", label: "Department" },
    { key: "office_name", label: "Office" },
    { key: "member_type", label: "Type" }
  ];

  const handleEdit = (member: any) => {
    setIsEditMode(true);
    setEditingId(member.id);
    setNewMember({
      name: member.name || "",
      prefix: member.prefix || "",
      designation: member.designation || "",
      department_id: member.department_id || "",
      office_id: member.office_id || "",
      email: member.email || "",
      member_type: member.member_type || "academic"
    });
    setIsModalOpen(true);
  };

  const handleDelete = (member: any) => {
    confirm("Delete Member", "Are you sure you want to delete this member?", async () => {
      try {
        await api.delete(`/members/${member.id}`);
        mutate();
        toast.success('Member deleted successfully');
      } catch (err) {
        console.error(err);
        toast.error('Failed to delete member');
      }
    });
  };

  const handleFetchApi = () => {
    confirm("Sync from APIs", "This will fetch external data and sync with the database. Are you sure you want to proceed?", async () => {
      try {
        const loadingToast = toast.loading("Fetching data from external APIs...");
        const res = await api.post('/members/fetch-external');
        toast.dismiss(loadingToast);
        toast.success(res.data.message || "Synced members successfully");
        mutate();
      } catch (err: any) {
        toast.error(err.response?.data?.message || "Failed to sync members");
      }
    });
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isEditMode && editingId) {
        await api.put(`/members/${editingId}`, newMember);
      } else {
        await api.post('/members', newMember);
      }
      setIsModalOpen(false);
      setIsEditMode(false);
      setEditingId(null);
      setNewMember({ name: "", prefix: "", designation: "", department_id: "", office_id: "", email: "", member_type: "academic" });
      mutate();
      toast.success(isEditMode ? 'Member updated successfully' : 'Member created successfully');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to save member');
    }
  };

  const handleAddNewOffice = async (officeNameBangla: string) => {
    try {
      const res = await api.post('/offices', {
        name_bangla: officeNameBangla,
        name_english: officeNameBangla // fallback
      });
      const newOfficeId = res.data.data.id;
      setNewMember({ ...newMember, office_id: newOfficeId });
      toast.success('Office added successfully');
      // Revalidate offices globally if SWR mutate was available, but it will sync eventually
    } catch (err: any) {
      toast.error('Failed to add new office');
    }
  };

  if (error) return <div className="p-8">Failed to load members</div>;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <ConfirmModal />
      <DataTable
        key={`${designationFilter}-${departmentFilter}-${officeFilter}-${typeFilter}`}
        columns={columns}
        data={displayedMembers}
        title="Manage Members"
        searchable
        searchPlaceholder="Search by name or designation..."
        filters={
          <>
            <div className="w-44">
              <CustomSelect
                value={designationFilter}
                onChange={setDesignationFilter}
                options={[
                  { value: "all", label: "All Designations" },
                  ...designationOptions.map((d) => ({ value: d, label: d }))
                ]}
              />
            </div>
            <div className="w-44">
              <CustomSelect
                value={departmentFilter}
                onChange={setDepartmentFilter}
                options={[
                  { value: "all", label: "All Departments" },
                  ...(deptRes?.data?.map((d: any) => ({ value: d.id, label: d.name_bangla })) || [])
                ]}
              />
            </div>
            <div className="w-44">
              <CustomSelect
                value={officeFilter}
                onChange={setOfficeFilter}
                options={[
                  { value: "all", label: "All Offices" },
                  ...(officeRes?.data?.map((o: any) => ({ value: o.id, label: o.name_bangla })) || [])
                ]}
              />
            </div>
            <div className="w-44">
              <CustomSelect
                value={typeFilter}
                onChange={setTypeFilter}
                options={[
                  { value: "all", label: "All Types" },
                  { value: "academic", label: "Academic" },
                  { value: "syndicate", label: "Syndicate" }
                ]}
              />
            </div>
          </>
        }
        onAdd={() => {
          setIsEditMode(false);
          setEditingId(null);
          setNewMember({ name: "", prefix: "", designation: "", department_id: "", office_id: "", email: "", member_type: "academic" });
          setIsModalOpen(true);
        }}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onFetchApi={handleFetchApi}
      />

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card w-full max-w-lg rounded-lg shadow-xl border border-border p-6 relative max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">{isEditMode ? "Edit Member" : "Add New Member"}</h3>
            <form onSubmit={handleAddSubmit} className="space-y-4">

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Name</label>
                  <input required value={newMember.name} onChange={e => setNewMember({ ...newMember, name: e.target.value })} className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Prefix</label>
                  <input value={newMember.prefix} onChange={e => setNewMember({ ...newMember, prefix: e.target.value })} className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Email</label>
                  <input type="email" value={newMember.email} onChange={e => setNewMember({ ...newMember, email: e.target.value })} className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Designation</label>
                  <SearchableSelect
                    options={[
                      { value: "", label: "None" },
                      { value: "অধ্যাপক", label: "অধ্যাপক" },
                      { value: "সহযোগী অধ্যাপক", label: "সহযোগী অধ্যাপক" },
                    ]}
                    value={newMember.designation}
                    onChange={(val) => setNewMember({ ...newMember, designation: val })}
                    placeholder="Select..."
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium">Type</label>
                <SearchableSelect
                  options={[
                    { value: "academic", label: "Academic" },
                    { value: "syndicate", label: "Syndicate" },
                    { value: "none", label: "None" }
                  ]}
                  value={newMember.member_type}
                  onChange={(val) => setNewMember({ ...newMember, member_type: val })}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium">Department</label>
                <SearchableSelect
                  options={departments}
                  value={newMember.department_id}
                  onChange={(val) => setNewMember({ ...newMember, department_id: val })}
                  placeholder="Select Department..."
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium">Office (Bangla)</label>
                <SearchableSelect
                  options={offices}
                  value={newMember.office_id}
                  onChange={(val) => setNewMember({ ...newMember, office_id: val })}
                  onAddNew={handleAddNewOffice}
                  placeholder="Search Office or add new..."
                />
              </div>

              <div className="flex justify-end space-x-2 pt-4">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm bg-muted text-muted-foreground rounded-md hover:bg-muted/80">Cancel</button>
                <button type="submit" className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90">{isEditMode ? "Update Member" : "Save Member"}</button>
              </div>

            </form>
          </div>
        </div>
      )}
    </div>
  );
}
