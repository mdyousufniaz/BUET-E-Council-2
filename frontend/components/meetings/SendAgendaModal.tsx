"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import { fetcher } from "../../lib/api";
import { X, Mail, Send, Search, CheckCircle2 } from "lucide-react";
import RichTextEditor from "../RichTextEditor";
import { toast } from "sonner";

interface SendAgendaModalProps {
  isOpen: boolean;
  onClose: () => void;
  meeting: any;
  currentUserEmail?: string; // TODO: wire this to your real auth/user context (see InviteesView.tsx)
}

type Tab = "invitees" | "email";

export default function SendAgendaModal({ isOpen, onClose, meeting, currentUserEmail }: SendAgendaModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>("invitees");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [isSending, setIsSending] = useState(false);

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

  // Reset local state whenever the modal opens/closes, and seed a default subject
  useEffect(() => {
    if (isOpen) {
      setSubject(`Meeting Agenda: ${meeting?.title || meeting?.name || "Untitled Meeting"}`);
    } else {
      setActiveTab("invitees");
      setSelectedIds([]);
      setSearchQuery("");
      setBody("");
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

  const handleSend = async () => {
    setIsSending(true);
    try {
      // ------------------------------------------------------------------
      // TODO: implement the actual send-agenda API call here, e.g.
      //
      // await api.post(`/meetings/${meeting.id}/invitees/send-agenda`, {
      //   invitee_ids: selectedIds,
      //   from: currentUserEmail,
      //   subject,
      //   body,
      // });
      //
      // Intentionally left as a placeholder per requirements — no backend
      // sending logic has been implemented yet.
      // ------------------------------------------------------------------
      toast.success(`Agenda queued for ${selectedIds.length} recipient(s)`);
      onClose();
    } catch (err: any) {
      toast.error("Failed to send agenda");
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
                <div className="space-y-2">
                  {filtered.map((invitee: any) => (
                    <label
                      key={invitee.id}
                      className="flex items-center gap-3 p-3 rounded-md border border-border hover:bg-muted/30 cursor-pointer"
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
                          {invitee.department_name ? ` • ${invitee.department_name}` : ""}
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

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Message</label>
                {/* Reuses the project's existing rich text editor. If RichTextEditor's
                    prop names differ from value/onChange, adjust the line below. */}
                <div className="border border-input rounded-md min-h-[200px] overflow-hidden">
                  <RichTextEditor content={body} onChange={setBody} />
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