"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { History, RotateCcw } from "lucide-react";
import useSWR from "swr";
import api, { fetcher } from "../../lib/api";
import { toast } from "sonner";
import { useConfirm } from "../../hooks/useConfirm";
import { useAuth } from "../../hooks/useAuth";

interface RevisionHistoryProps {
  contentId: string;
  contentType: "agendaItem" | "resolutionItem";
  onRestored?: () => void;
  className?: string;
  // Whether the current user may restore a revision. When omitted, falls back
  // to the generic staff flag; meeting views pass an ownership-aware value.
  canRestore?: boolean;
}

const stripHtml = (html: string) => html.replace(/<[^>]*>?/gm, "").trim();

const formatRelative = (iso: string) => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

export default function RevisionHistory({ contentId, contentType, onRestored, className, canRestore }: RevisionHistoryProps) {
  const { canEdit: staffCanEdit } = useAuth();
  const canEdit = canRestore ?? staffCanEdit;
  if (!canEdit) return null;

  const [isOpen, setIsOpen] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties>({});
  const [mounted, setMounted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { confirm, ConfirmModal } = useConfirm();

  useEffect(() => setMounted(true), []);

  const { data: response, mutate } = useSWR(
    isOpen ? `/agendas/${contentId}/revisions?content_type=${contentType}` : null,
    fetcher
  );
  const revisions = response?.data || [];

  const updatePosition = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setStyle({ position: "fixed", top: rect.bottom + 4, right: window.innerWidth - rect.right, zIndex: 99999 });
    }
  };

  useEffect(() => {
    if (isOpen) {
      updatePosition();
      window.addEventListener("scroll", updatePosition, true);
      window.addEventListener("resize", updatePosition);
    }
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [isOpen]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      const panel = document.getElementById(`revision-history-panel-${contentId}`);
      if (buttonRef.current?.contains(target)) return;
      if (panel && !panel.contains(target)) setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [contentId]);

  const handleRestore = (revisionId: string) => {
    confirm("Restore Revision", "This will replace the current content with this older version. The current version will itself be saved to history.", async () => {
      try {
        await api.post(`/agendas/${contentId}/revisions/${revisionId}/restore?content_type=${contentType}`);
        toast.success("Revision restored");
        mutate();
        onRestored?.();
        setIsOpen(false);
      } catch (err) {
        toast.error("Failed to restore revision");
      }
    });
  };

  return (
    <div className={className}>
      <ConfirmModal />
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity p-1.5 bg-muted rounded-md hover:bg-muted/70 flex items-center gap-1.5"
        title="Revision History"
      >
        <History className="w-3.5 h-3.5" />
      </button>

      {isOpen && mounted && typeof document !== "undefined" && createPortal(
        <div
          id={`revision-history-panel-${contentId}`}
          style={style}
          className="w-80 max-h-96 overflow-y-auto bg-popover text-popover-foreground border border-border rounded-md shadow-xl"
        >
          <div className="p-3 border-b border-border/50 font-semibold text-sm sticky top-0 bg-popover">
            Revision History
          </div>
          {revisions.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground text-center">No previous versions yet.</div>
          ) : (
            <ul className="divide-y divide-border/50">
              {revisions.map((rev: any) => (
                <li key={rev.id} className="p-3 text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-foreground">
                      {rev.modified_by_username || "Unknown"}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatRelative(rev.modified_at)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                    {stripHtml(rev.text_content).slice(0, 140) || "Empty content..."}
                  </p>
                  {canEdit && (
                    <button
                      onClick={() => handleRestore(rev.id)}
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <RotateCcw className="w-3 h-3" /> Restore this version
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
