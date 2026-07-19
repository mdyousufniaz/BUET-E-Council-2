"use client";

import { useState, useEffect, useMemo } from "react";
import useSWR from "swr";
import api, { fetcher } from "../../lib/api";
import { X, Mail, Send, Search, CheckCircle2, Paperclip, FileText, Building, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";
import RichTextEditor from "../RichTextEditor";

interface SendAgendaModalProps {
  isOpen: boolean;
  onClose: () => void;
  meeting: any;
  currentUserEmail?: string; // TODO: wire this to your real auth/user context (see InviteesView.tsx)
}

type Tab = "invitees" | "email";

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

export default function SendAgendaModal({ isOpen, onClose, meeting, currentUserEmail }: SendAgendaModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>("invitees");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [attachAgendaPdf, setAttachAgendaPdf] = useState(true);
  const [extraAttachments, setExtraAttachments] = useState<File[]>([]);

  // Lightweight "invitees with email" fetch — only while the modal is open.
  // Backed by GET /meetings/:id/invitees/emails (see meetingController.getInviteesEmails)
  const { data: emailInviteesRes, isLoading } = useSWR(
    isOpen && meeting?.id ? `/meetings/${meeting.id}/invitees/emails` : null,
    fetcher
  );
  const invitees = emailInviteesRes?.data || [];
  const invitesWithEmail = invitees.filter((i: any) => !!i.email);
  const invitesWithoutEmail = invitees.filter((i: any) => !i.email);

  const filtered = invitesWithEmail.filter((i: any) =>
    i.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectedInvitees = invitesWithEmail.filter((i: any) => selectedIds.includes(i.id));
  const toEmails = selectedInvitees.map((i: any) => i.email).join(", ");

  // Group the (search-filtered) invitees the same way TakeAttendanceView does —
  // VC & Pro-VC, then departments sorted by department_serial, then Others —
  // so recipients can be picked a whole department at a time.
  const { vcGroup, deptGroups, othersGroup } = useMemo(() => {
    const vc: any[] = [];
    const depts: Record<string, { serial: number; members: any[] }> = {};
    const others: any[] = [];

    const isVC = (designation: string) => {
      if (!designation) return false;
      const lower = designation.toLowerCase();
      return lower.includes('উপাচার্য') || lower.includes('vc');
    };

    filtered.forEach((invitee: any) => {
      if (isVC(invitee.designation)) {
        vc.push(invitee);
      } else if (invitee.department_name) {
        if (!depts[invitee.department_name]) {
          depts[invitee.department_name] = { serial: invitee.department_serial ?? 9999, members: [] };
        }
        depts[invitee.department_name].members.push(invitee);
      } else {
        others.push(invitee);
      }
    });

    const bySerial = (a: any, b: any) => (a.serial ?? Infinity) - (b.serial ?? Infinity);
    vc.sort(bySerial);
    others.sort(bySerial);
    Object.values(depts).forEach((dept) => dept.members.sort(bySerial));

    const sortedDepts = Object.entries(depts)
      .sort(([, a], [, b]) => a.serial - b.serial)
      .map(([name, data]) => ({ name, members: data.members }));

    return { vcGroup: vc, deptGroups: sortedDepts, othersGroup: others };
  }, [filtered]);

  // Reset local state whenever the modal opens/closes, and seed a default subject
  useEffect(() => {
    if (isOpen) {
      setSubject(`Meeting Agenda: ${meeting?.title || meeting?.name || "Untitled Meeting"}`);
    } else {
      setActiveTab("invitees");
      setSelectedIds([]);
      setSearchQuery("");
      setBody("");
      setAttachAgendaPdf(true);
      setExtraAttachments([]);
    }
  }, [isOpen, meeting]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filtered.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filtered.map((i: any) => i.id));
    }
  };

  const toggleGroupSelect = (members: any[], isAllSelected: boolean) => {
    const memberIds = members.map((m) => m.id);
    setSelectedIds((prev) => {
      if (isAllSelected) return prev.filter((id) => !memberIds.includes(id));
      const next = new Set(prev);
      memberIds.forEach((id) => next.add(id));
      return Array.from(next);
    });
  };

  const renderGroup = (title: string, members: any[], icon: React.ReactNode) => {
    if (members.length === 0) return null;

    const isAllSelected = members.every((m: any) => selectedIds.includes(m.id));
    const isIndeterminate = members.some((m: any) => selectedIds.includes(m.id)) && !isAllSelected;

    return (
      <div key={title} className="border border-border rounded-lg overflow-hidden">
        <div className="bg-muted/50 px-4 py-2.5 flex items-center justify-between border-b border-border">
          <div className="flex items-center gap-2">
            {icon}
            <h4 className="text-sm font-semibold text-foreground">{title}</h4>
            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
              {members.length}
            </span>
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              className="w-4 h-4 rounded border-input"
              checked={isAllSelected}
              ref={(input) => { if (input) input.indeterminate = isIndeterminate; }}
              onChange={() => toggleGroupSelect(members, isAllSelected)}
            />
            <span className="text-xs font-medium text-muted-foreground">Select All</span>
          </label>
        </div>
        <div className="divide-y divide-border">
          {members.map((invitee: any) => (
            <label
              key={invitee.id}
              className="flex items-center gap-3 p-3 hover:bg-muted/30 cursor-pointer"
            >
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-input"
                checked={selectedIds.includes(invitee.id)}
                onChange={() => toggleSelect(invitee.id)}
              />
              <div className="flex-1">
                <div className="font-medium text-sm">{invitee.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {invitee.designation}
                  {invitee.office_name ? ` • ${invitee.office_name}` : ""}
                </div>
                <div className="text-xs text-primary mt-0.5">{invitee.email}</div>
              </div>
              {selectedIds.includes(invitee.id) && (
                <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
              )}
            </label>
          ))}
        </div>
      </div>
    );
  };

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    setExtraAttachments((prev) => [...prev, ...Array.from(files)]);
  };

  const removeExtraAttachment = (index: number) => {
    setExtraAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    setIsSending(true);
    try {
      const attachments = await Promise.all(
        extraAttachments.map(async (file) => ({
          filename: file.name,
          content: await fileToBase64(file),
          contentType: file.type || "application/octet-stream",
        }))
      );

      const res = await api.post(`/meetings/${meeting.id}/send-email`, {
        invitee_ids: selectedIds,
        from: currentUserEmail,
        subject,
        content: body,
        attach_agenda: attachAgendaPdf,
        attachments,
      });

      const sent = res.data?.data?.sent || [];
      const failed = res.data?.data?.failed || [];

      if (sent.length > 0 && failed.length > 0) {
        toast.warning(res.data?.message || `Sent to ${sent.length} recipient(s), ${failed.length} failed`);
      } else if (sent.length > 0) {
        toast.success(res.data?.message || `Agenda emailed to ${sent.length} recipient(s)`);
      } else {
        toast.error(res.data?.message || "Failed to send agenda");
      }
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to send agenda");
    } finally {
      setIsSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card w-full max-w-3xl max-h-[90vh] rounded-lg shadow-xl border border-border flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-border flex justify-between items-center shrink-0">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Mail className="w-5 h-5 text-primary" /> Send Agenda
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">{meeting?.title || meeting?.name}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Horizontal Tabs */}
        <div className="flex border-b border-border shrink-0 px-6">
          <button
            onClick={() => setActiveTab("invitees")}
            className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === "invitees"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Invitees {selectedIds.length > 0 && `(${selectedIds.length})`}
          </button>
          <button
            onClick={() => setActiveTab("email")}
            className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === "email"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Email
          </button>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === "invitees" && (
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search invitees..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-input/20 border border-input rounded-md text-sm"
                  />
                </div>
                <button
                  onClick={toggleSelectAll}
                  className="text-sm font-medium text-primary hover:underline shrink-0"
                >
                  {selectedIds.length === filtered.length && filtered.length > 0 ? "Deselect All" : "Select All"}
                </button>
              </div>

              {isLoading ? (
                <div className="text-center text-sm text-muted-foreground py-8">Loading invitees...</div>
              ) : filtered.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-8">
                  No invitees with an email address found.
                </div>
              ) : (
                <div className="space-y-4">
                  {renderGroup("VC & Pro-VC", vcGroup, <ShieldCheck className="w-4 h-4 text-primary" />)}
                  {deptGroups.map((dept) =>
                    renderGroup(dept.name, dept.members, <Building className="w-4 h-4 text-blue-500" />)
                  )}
                  {renderGroup("Others", othersGroup, <Users className="w-4 h-4 text-muted-foreground" />)}
                </div>
              )}

              {invitesWithoutEmail.length > 0 && (
                <p className="text-xs text-muted-foreground pt-2 border-t border-border">
                  {invitesWithoutEmail.length} invitee(s) have no email on file and are excluded from this list.
                </p>
              )}
            </div>
          )}

          {activeTab === "email" && (
            <div className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">From</label>
                <input
                  type="email"
                  value={currentUserEmail || ""}
                  readOnly
                  className="w-full px-3 py-2 bg-muted/30 border border-input rounded-md text-sm cursor-not-allowed"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">To</label>
                <textarea
                  value={toEmails}
                  placeholder="No recipients selected yet — pick invitees in the first tab"
                  readOnly
                  rows={2}
                  className="w-full px-3 py-2 bg-muted/30 border border-input rounded-md text-sm cursor-not-allowed resize-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full px-3 py-2 bg-input/20 border border-input rounded-md text-sm focus:ring-1 focus:ring-ring"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">Attachments</label>
                  <label className="text-sm font-medium text-primary hover:underline cursor-pointer flex items-center gap-1">
                    <Paperclip className="w-4 h-4" /> Add files
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        addFiles(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-3 p-2.5 rounded-md border border-border bg-muted/20">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded border-input"
                      checked={attachAgendaPdf}
                      onChange={(e) => setAttachAgendaPdf(e.target.checked)}
                    />
                    <FileText className="w-4 h-4 text-primary shrink-0" />
                    <span className="flex-1 text-sm">Meeting Agenda.pdf</span>
                    <span className="text-xs text-muted-foreground">Generated automatically</span>
                  </label>

                  {extraAttachments.map((file, idx) => (
                    <div
                      key={`${file.name}-${idx}`}
                      className="flex items-center gap-3 p-2.5 rounded-md border border-border"
                    >
                      <Paperclip className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="flex-1 text-sm truncate">{file.name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">{formatBytes(file.size)}</span>
                      <button
                        type="button"
                        onClick={() => removeExtraAttachment(idx)}
                        className="text-muted-foreground hover:text-foreground shrink-0"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Message</label>
                <div className="border border-input rounded-md overflow-hidden">
                  <RichTextEditor
                    content={body}
                    onChange={setBody}
                    className="p-4 min-h-[200px]"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-border shrink-0 flex justify-between items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {selectedIds.length === 0
              ? "Select at least one invitee to continue"
              : `${selectedIds.length} recipient(s) selected`}
          </span>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm bg-muted text-muted-foreground rounded-md hover:bg-muted/80"
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={selectedIds.length === 0 || isSending}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md flex items-center gap-2 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
              {isSending ? "Sending..." : "Send Email"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}