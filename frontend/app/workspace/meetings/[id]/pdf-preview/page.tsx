"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import {
  ArrowLeft,
  Download,
  Printer,
  Loader2,
  Pencil,
  Check,
  X,
  FileText,
  Layers,
  FileCheck,
  ClipboardCheck,
} from "lucide-react";
import api, { fetcher } from "../../../../../lib/api";
import { useAuth } from "../../../../../hooks/useAuth";
import {
  canEditAgenda,
  canEditSuppliAgenda,
  canEditResolution,
  canEditDescription,
  canEditConclusion,
} from "../../../../../lib/meetingAccess";
import { toBanglaDigits, getSerialWidth } from "../../../../../lib/banglaNumerals";
import { sanitizeHtml } from "../../../../../lib/sanitize";
import RichTextEditor from "../../../../../components/RichTextEditor";

type DocType = "agenda" | "suppli-agenda" | "resolution" | "resolution-status";
// id "meeting" is the sentinel for the meeting-level description / conclusion cells.
type EditField = "content" | "resolution" | "description" | "conclusion";
type EditTarget = { id: string; field: EditField } | null;

const PAGE_SIZES: Record<string, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
  A5: { w: 148, h: 210 },
  Letter: { w: 216, h: 279 },
  Legal: { w: 216, h: 356 },
  Tabloid: { w: 279, h: 432 },
};

const STATUS_DEFAULTS: Record<string, string> = {
  not_executed: "অবাস্তবায়িত",
  executed: "বাস্তবায়িত",
  submitted: "পরবর্তী মিটিং এ উপস্থাপনের জন্য আবেদন করা হল",
};

/** Split the agenda prefix into { ac, rest } on whitespace. First token is the
 *  A/C column; everything after it is the leading (locked) part of column 3.
 *  Malformed input (empty / single token / extra spaces) degrades gracefully. */
function splitPrefix(prefix?: string | null): { ac: string; rest: string } {
  const raw = (prefix ?? "").trim();
  if (!raw) return { ac: "", rest: "" };
  const tokens = raw.split(/\s+/);
  if (tokens.length === 1) return { ac: "", rest: tokens[0] };
  return { ac: tokens[0], rest: tokens.slice(1).join(" ") };
}

const stripTags = (html: string) => (html || "").replace(/<[^>]*>/g, "").trim();

// Leading "বিবিধ :" title (optionally followed by its serial number). Only
// digits are stripped after "বিবিধ" — never a following word — so imported
// আলোচ্যসূচি text is left intact. Keep in sync with pdfGenerator.js.
const BIBIDHA_TITLE_RE = /^\s*বিবিধ\s*[:.\-]?\s*(?:[০-৯\d]+\s*)?[:.\-]?\s*/i;
const isBibidhaAgenda = (ag: any) =>
  !!ag && !ag.is_suppli && (ag.agenda_serial === 0 || stripTags(ag.content || "").startsWith("বিবিধ"));
// Text a bibidha item carries beyond its "বিবিধ :" title (e.g. from a JSON import).
const bibidhaBodyText = (ag: any) => stripTags(ag?.content || "").replace(BIBIDHA_TITLE_RE, "").trim();

function statusText(ag: any): string {
  const explicit = ag.execution_status ? stripTags(ag.execution_status) : "";
  if (explicit) return ag.execution_status;
  const st = ag.resolution_status;
  const submitted =
    st === "submitted" || ag.is_submitted_for_next_meeting === true || ag.is_submitted_for_next_meeting === "t";
  const executed = st === "executed" || ag.is_executed === true || ag.is_executed === "t";
  if (submitted) return STATUS_DEFAULTS.submitted;
  if (executed) return STATUS_DEFAULTS.executed;
  if (st === "custom") return "";
  return STATUS_DEFAULTS.not_executed;
}

export default function PdfPreviewPage() {
  const params = useParams();
  const id = params.id as string;
  const { user } = useAuth();

  const { data: meetingRes, error: meetingErr, mutate: mutateMeeting } = useSWR(
    `/meetings/${id}`,
    fetcher
  );
  const meeting = meetingRes?.data;

  const { data: agRes, mutate: mutateAgendas } = useSWR(
    `/agendas?meeting_id=${id}`,
    fetcher,
    { fallbackData: { data: [] } }
  );

  const isEmergency = meeting?.is_regular === false;

  const [docType, setDocType] = useState<DocType>("agenda");
  const [editing, setEditing] = useState<EditTarget>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  // "pdf" shows the real generated PDF in an <iframe> so the preview is exactly
  // what downloads/prints; "edit" shows the inline-editing grid. Bumping
  // previewNonce forces the PDF to re-render (used after an inline edit saves).
  const [previewMode, setPreviewMode] = useState<"pdf" | "edit">("pdf");
  const [previewNonce, setPreviewNonce] = useState(0);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false);
  const [pdfPreviewError, setPdfPreviewError] = useState<string | null>(null);
  const pdfPreviewUrlRef = useRef<string | null>(null);

  // ---- Page layout controls --------------------------------------------
  const [pageSize, setPageSize] = useState("A4");
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");
  const [margins, setMargins] = useState({ top: 20, right: 20, bottom: 20, left: 20 });
  const [scalePct, setScalePct] = useState(100);
  const [lineHeight, setLineHeight] = useState<number | "">("");

  const layoutQuery = useMemo(() => {
    const qs = new URLSearchParams({
      pageSize,
      orientation,
      marginTop: String(margins.top),
      marginRight: String(margins.right),
      marginBottom: String(margins.bottom),
      marginLeft: String(margins.left),
      scale: String(scalePct / 100),
      // Match the on-screen 3-column layout: body opens with a bold "<n>:" run
      // instead of a separate "প্রস্তাব নং <n>" heading line.
      agendaNumberStyle: "inline",
    });
    if (lineHeight !== "") qs.set("lineHeight", String(lineHeight));
    return qs.toString();
  }, [pageSize, orientation, margins, scalePct, lineHeight]);

  // Render the actual PDF for the "pdf" preview mode. Debounced so dragging the
  // layout sliders doesn't fire a request per keystroke.
  useEffect(() => {
    if (previewMode !== "pdf" || !id) return;
    let cancelled = false;
    setPdfPreviewLoading(true);
    setPdfPreviewError(null);
    const t = setTimeout(async () => {
      try {
        const res = await api.get(`/meetings/${id}/pdf/${docType}?${layoutQuery}`, {
          responseType: "blob",
        });
        if (cancelled) return;
        const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
        if (pdfPreviewUrlRef.current) URL.revokeObjectURL(pdfPreviewUrlRef.current);
        pdfPreviewUrlRef.current = url;
        setPdfPreviewUrl(url);
      } catch (e: any) {
        if (!cancelled) setPdfPreviewError(e?.response?.data?.message || "Failed to render preview");
      } finally {
        if (!cancelled) setPdfPreviewLoading(false);
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [id, docType, layoutQuery, previewMode, previewNonce]);

  // Revoke the last blob URL when leaving the page.
  useEffect(
    () => () => {
      if (pdfPreviewUrlRef.current) URL.revokeObjectURL(pdfPreviewUrlRef.current);
    },
    []
  );

  // ---- Agenda data ---------------------------------------------------
  const allAgendas = useMemo(() => {
    const list = [...((agRes?.data as any[]) || [])];
    list.sort((a, b) => {
      if (a.is_suppli === b.is_suppli) return (a.agenda_serial || 0) - (b.agenda_serial || 0);
      return a.is_suppli ? 1 : -1;
    });
    return list;
  }, [agRes]);

  const mainAgendas = allAgendas.filter((a) => !a.is_suppli);
  const suppliAgendas = allAgendas.filter((a) => a.is_suppli);
  const mainAgendaCount = mainAgendas.filter((a) => {
    const clean = stripTags(a.content || "");
    return a.agenda_serial !== 0 && !clean.startsWith("বিবিধ");
  }).length;
  const serialWidth = getSerialWidth(allAgendas.length || 1);

  const canEdit =
    docType === "resolution"
      ? canEditResolution(user, meeting)
      : docType === "suppli-agenda"
        ? canEditSuppliAgenda(user, meeting)
        : docType === "agenda"
          ? canEditAgenda(user, meeting)
          : false; // resolution-status is a read-only view here

  const canEditMeetingField = (field: "description" | "conclusion") =>
    field === "conclusion" ? canEditConclusion(user, meeting) : canEditDescription(user, meeting);

  const { ac, rest } = splitPrefix(meeting?.agenda_prefix);

  const serialFor = (ag: any) => {
    const clean = stripTags(ag.content || "");
    const isBibidha = !ag.is_suppli && (ag.agenda_serial === 0 || clean.startsWith("বিবিধ"));
    if (isBibidha) return toBanglaDigits(mainAgendaCount + 1, serialWidth);
    return ag.is_suppli
      ? toBanglaDigits(mainAgendaCount + (ag.agenda_serial || 1), serialWidth)
      : toBanglaDigits(ag.agenda_serial || 0, serialWidth);
  };

  // Category grouping: a header row precedes the first agenda of every run of
  // consecutive items that share a category. Keyed by that first item's id.
  const categoryHeaderMap: Map<string, string> = (() => {
    const map = new Map<string, string>();
    let groupCatId: string | null = null;
    let group: any[] = [];
    const flush = () => {
      if (group.length && groupCatId) {
        const catName = String(group[0].category_name || "").trim();
        const start = serialFor(group[0]);
        const end = serialFor(group[group.length - 1]);
        const range =
          start === end ? `প্রস্তাব নং ${start}` : `প্রস্তাব নং ${start} হতে ${end}`;
        map.set(group[0].id, `${catName} (${range})`);
      }
      group = [];
    };
    for (const ag of allAgendas) {
      const clean = stripTags(ag.content || "");
      const isBibidha = !ag.is_suppli && (ag.agenda_serial === 0 || clean.startsWith("বিবিধ"));
      const catName = ag.category_name ? String(ag.category_name).trim() : "";
      const uncategorized =
        !catName || /^(uncategorized|un-categorized|অশ্রেণীভুক্ত|অশ্রেণিভুক্ত)$/i.test(catName);
      if (isBibidha || !ag.category_id || uncategorized) {
        flush();
        groupCatId = null;
      } else {
        if (ag.category_id !== groupCatId) {
          flush();
          groupCatId = ag.category_id;
        }
        group.push(ag);
      }
    }
    flush();
    return map;
  })();

  const docLabel =
    docType === "resolution"
      ? "কার্যবিবরণী"
      : docType === "resolution-status"
        ? "সিদ্ধান্ত বাস্তবায়ন অবস্থা"
        : docType === "suppli-agenda"
          ? "সম্পূরক আলোচ্যসূচি"
          : "আলোচ্যসূচী";

  // Heading block, computed exactly like meeting_service/utils/pdfGenerator.js
  // (buildMeetingHtml) so the "edit" view matches the generated PDF.
  const heading = (() => {
    const formatMeetingSerial = (rawTitle: string) =>
      !rawTitle
        ? ""
        : toBanglaDigits(
            String(rawTitle)
              .trim()
              .replace(/^(meeting\s*|councel\s*|council\s*)/i, "")
              .replace(/^(\d+)(st|nd|rd|th)$/i, "$1")
              .trim(),
          );

    const d = meeting.meeting_date ? new Date(meeting.meeting_date) : null;
    const dateShort = d
      ? `${toBanglaDigits(d.getDate(), 2)}-${toBanglaDigits(String(d.getMonth() + 1).padStart(2, "0"), 2)}-${toBanglaDigits(d.getFullYear())}`
      : "";
    const meetingDate = d
      ? toBanglaDigits(d.toLocaleDateString("bn-BD", { year: "numeric", month: "long", day: "numeric" }))
      : "";
    const serialNo = formatMeetingSerial(meeting.title || "Untitled");
    const serialNoDigits = serialNo.replace(/[^\d০-৯]/g, "");
    const formattedSerial = serialNoDigits ? toBanglaDigits(serialNoDigits, 2) : toBanglaDigits(serialNo, 2);
    const meetingSerialLabel =
      serialNo.includes("সভা") || serialNo.includes("কাউন্সিল") ? serialNo : `${serialNo}তম সভার`;
    const typeStr = (meeting.type || "").toLowerCase();
    const isSyndicate = typeStr === "syndicate" || typeStr.includes("syndicate");
    const councilLabel = isSyndicate ? "সিন্ডিকেটের" : "একাডেমিক কাউন্সিলের";
    const dateVerb = docType === "resolution" || docType === "resolution-status" ? "অনুষ্ঠিত" : "অনুষ্ঠিতব্য";

    if (docType === "suppli-agenda") {
      return {
        university: false,
        subtitle: `${meetingDate} তারিখে অনুষ্ঠিতব্য ${councilLabel} ${serialNo}তম সভার সাপ্লিমেন্টারী আলোচ্যসূচী।`,
      };
    }
    if (isEmergency) {
      return {
        university: true,
        subtitle: `${dateShort} তারিখে অনুষ্ঠিতব্য ${councilLabel} ${formattedSerial}তম জরুরী (Immediate) সভার ${docLabel}`,
      };
    }
    return {
      university: true,
      subtitle: `${meetingDate} তারিখে ${dateVerb} ${meetingSerialLabel} ${docLabel}`,
    };
  })();

  // ---- Actions -----------------------------------------------------
  const startEdit = (ag: any, field: EditField) => {
    if (field === "description" || field === "conclusion") {
      setEditing({ id: "meeting", field });
      setDraft(meeting?.[field] || "");
      return;
    }
    setEditing({ id: ag.id, field });
    setDraft(field === "content" ? ag.content || "" : ag.resolution || "");
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraft("");
  };

  const savingRef = useRef(false);
  const saveEdit = async () => {
    if (!editing || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      if (editing.field === "description" || editing.field === "conclusion") {
        await api.put(`/meetings/${id}`, { [editing.field]: draft });
        await mutateMeeting();
      } else if (editing.field === "content") {
        await api.put(`/agendas/${editing.id}`, { content: draft });
        await mutateAgendas();
      } else {
        const ag = allAgendas.find((a) => a.id === editing.id);
        await api.put(`/agendas/resolutions/${editing.id}`, {
          resolution: stripTags(draft) ? draft : "<p>.</p>",
          tag_ids: (ag?.tags || []).map((t: any) => t.id),
        });
        await mutateAgendas();
      }
      toast.success("Saved");
      setEditing(null);
      setDraft("");
      setPreviewNonce((n) => n + 1); // refresh the PDF preview with the new content
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to save");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const downloadPdf = async (type: DocType) => {
    setDownloading(type);
    try {
      const res = await api.get(`/meetings/${id}/pdf/${type}?${layoutQuery}`, {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${type}-${meeting?.title || id}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error("Failed to generate PDF");
    } finally {
      setDownloading(null);
    }
  };

  // ---- Render helpers -------------------------------------------
  const size = PAGE_SIZES[pageSize] || PAGE_SIZES.A4;
  const paperW = orientation === "landscape" ? size.h : size.w;
  const paperH = orientation === "landscape" ? size.w : size.h;

  // Print rules: the structural preview grid (.preview-grid) prints borderless so
  // the document reads as prose — but tables authored INSIDE the rich text editor
  // (nested deeper than a direct grid cell) keep their own borders. All text
  // prints black regardless of the on-screen theme.
  const printCss = `
    /* Keep the on-screen preview closer to the generated PDF: match its 14px
       body text, and render rich-text tables the way both the editor and the
       PDF now do -- full page width with evenly-split, fixed-layout columns
       (see styleRichTextHtml in pdfGenerator.js and .meeting-table in
       globals.css). Manual column widths still come through in the generated
       PDF via the injected <colgroup>. */
    #pdf-print-root { font-size: 14px; }
    #pdf-print-root .prose :where(table):not(.preview-grid) {
      width: 100%;
      max-width: 100%;
      table-layout: fixed;
    }
    #pdf-print-root .prose :where(table):not(.preview-grid) :where(td, th) {
      overflow-wrap: break-word;
      word-break: normal;
    }
    @media print {
      @page { size: ${pageSize} ${orientation}; margin: ${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm; }
      body * { visibility: hidden !important; }
      #pdf-print-root, #pdf-print-root * { visibility: visible !important; color: #000 !important; }
      #pdf-print-root { position: absolute; inset: 0; margin: 0 !important; padding: 0 !important; box-shadow: none !important; width: auto !important; }
      #pdf-print-root table.preview-grid,
      #pdf-print-root table.preview-grid > tbody > tr > td { border: none !important; padding-left: 0 !important; padding-right: 0 !important; }
      .no-print { display: none !important; }
    }
  `;

  // Plain render helper (NOT a component) so the RichTextEditor inside an editing
  // cell keeps its identity across re-renders instead of remounting per keystroke.
  // `ag` is null for the meeting-level description / conclusion cells.
  const renderCell = (ag: any, field: EditField, lockedPrefix?: string) => {
    const isMeetingField = field === "description" || field === "conclusion";
    const targetId = isMeetingField ? "meeting" : ag.id;
    const isEditingThis = editing?.id === targetId && editing?.field === field;
    const html = isMeetingField
      ? meeting?.[field]
      : field === "content"
        ? ag.content
        : ag.resolution;
    // An empty bibidha item (just the "বিবিধ :" title, no imported text) has
    // nothing to edit in the আলোচ্যসূচি column — no edit affordance at all.
    // Once it carries real text it becomes editable like any other row.
    const contentLocked =
      !isMeetingField && field === "content" && isBibidhaAgenda(ag) && !bibidhaBodyText(ag);
    const editable = isMeetingField ? canEditMeetingField(field) : (canEdit && !contentLocked);
    const bold = field === "resolution";

    if (isEditingThis) {
      return (
        <div className="not-prose border border-primary rounded-md overflow-hidden bg-background text-left text-foreground">
          {lockedPrefix && (
            <div className="px-3 pt-2 font-bold select-none">{lockedPrefix}</div>
          )}
          <RichTextEditor
            content={draft}
            onChange={setDraft}
            onSave={saveEdit}
            className="p-3 min-h-[160px]"
          />
          <div className="flex justify-end gap-2 p-2 bg-muted border-t border-border">
            <button
              onClick={cancelEdit}
              className="flex items-center gap-1 px-2.5 py-1 text-xs text-muted-foreground hover:bg-background rounded"
            >
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
            <button
              onClick={saveEdit}
              disabled={saving}
              className="flex items-center gap-1 px-2.5 py-1 text-xs bg-primary text-primary-foreground rounded disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Save
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="group relative">
        <div className={`prose prose-sm max-w-none [&_*]:!my-1 ${bold ? "font-bold [&_*]:font-bold" : ""}`}>
          {lockedPrefix && <b className="select-none">{lockedPrefix} </b>}
          <span
            className={lockedPrefix ? "[&>p:first-child]:inline" : undefined}
            dangerouslySetInnerHTML={{
              __html: html ? sanitizeHtml(html) : "<p style='opacity:.4;font-style:italic'>(empty)</p>",
            }}
          />
        </div>
        {editable && (
          <button
            onClick={() => startEdit(ag, field)}
            title="Edit — Ctrl+S to save"
            className="no-print absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded bg-primary text-primary-foreground shadow"
          >
            <Pencil className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  };

  const categoryHeaderRow = (ag: any, span: number) => {
    const header = categoryHeaderMap.get(ag.id);
    if (!header) return null;
    return (
      <tr>
        <td colSpan={span} className="border border-border px-3 py-1.5 font-bold">
          {header}
        </td>
      </tr>
    );
  };

  const agendaRow = (ag: any) => {
    const serial = serialFor(ag);
    const clean = stripTags(ag.content || "");
    const isBibidha = !ag.is_suppli && (ag.agenda_serial === 0 || clean.startsWith("বিবিধ"));
    return (
      <Fragment key={ag.id}>
        {categoryHeaderRow(ag, 3)}
        <tr className="align-top">
          <td className="border border-border px-2 py-1.5 text-center font-bold w-[14%] whitespace-nowrap">
            {isBibidha ? `বিবিধ : ${ac ? ac + " " : ""}${rest}${serial}` : "প্রস্তাব নং"}
          </td>
          <td className="border border-border px-2 py-1.5 text-center whitespace-nowrap font-bold w-[10%]">
            {isBibidha ? " " : ac || " "}
          </td>
          <td className="border border-border px-3 py-1.5">
            {renderCell(ag, "content", isBibidha ? undefined : `${rest}${serial}:`)}
          </td>
        </tr>
      </Fragment>
    );
  };

  // ---- Loading / error --------------------------------------------
  if (meetingErr) {
    return <div className="p-8 text-destructive">Failed to load meeting.</div>;
  }
  if (!meeting) {
    return (
      <div className="p-8 text-muted-foreground flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading preview…
      </div>
    );
  }

  // Resolution & resolution-status omit a bibidha item that has neither a
  // recorded সিদ্ধান্ত nor any imported আলোচ্যসূচি text — matching the generated
  // PDF (filterOutEmptyBibidha in pdfGenerator.js). The agenda PDF still lists
  // an empty বিবিধ (as "বিবিধ : <serial>").
  const resolutionAgendas = allAgendas.filter(
    (ag: any) => !isBibidhaAgenda(ag) || !!stripTags(ag.resolution || "") || !!bibidhaBodyText(ag),
  );

  const activeAgendas =
    docType === "suppli-agenda" ? suppliAgendas : docType === "agenda" ? mainAgendas : allAgendas;
  const meetingHeading = meeting.meeting_title || meeting.title || "";

  const roHtml = (html: string | null | undefined, empty: string) => (
    <div
      className="prose prose-sm max-w-none [&_*]:!my-1"
      dangerouslySetInnerHTML={{
        __html: html
          ? sanitizeHtml(html)
          : `<p style='opacity:.4;font-style:italic'>${empty}</p>`,
      }}
    />
  );

  return (
    <div className="flex flex-col h-full bg-muted/30">
      <style dangerouslySetInnerHTML={{ __html: printCss }} />

      {/* Toolbar */}
      <div className="no-print shrink-0 border-b border-border bg-card">
        <div className="flex items-center justify-between gap-4 px-4 py-2.5">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href={`/workspace/meetings/${id}?view=materials`}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground shrink-0"
            >
              <ArrowLeft className="w-4 h-4" /> Materials
            </Link>
            <div className="h-5 w-px bg-border" />
            <h1 className="text-sm font-semibold truncate">{meetingHeading} — PDF Preview</h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-0.5 p-0.5 bg-muted rounded-lg mr-1">
              <button
                onClick={() => setPreviewMode("pdf")}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                  previewMode === "pdf" ? "bg-primary text-primary-foreground shadow-sm" : "text-foreground hover:bg-card"
                }`}
                title="Exact PDF — what will download / print"
              >
                PDF
              </button>
              <button
                onClick={() => setPreviewMode("edit")}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                  previewMode === "edit" ? "bg-primary text-primary-foreground shadow-sm" : "text-foreground hover:bg-card"
                }`}
                title="Edit agenda / resolution / description text inline"
              >
                Edit
              </button>
            </div>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-input rounded-md hover:bg-muted"
            >
              <Printer className="w-3.5 h-3.5" /> Print view
            </button>
            <button
              onClick={() => downloadPdf(docType)}
              disabled={!!downloading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              {downloading === docType ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              Download PDF
            </button>
          </div>
        </div>

        {/* Doc type + layout controls */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 pb-3 text-xs">
          <div className="flex items-center gap-1 p-0.5 bg-muted rounded-lg">
            {([
              ["agenda", "Agenda", FileText],
              ...(!isEmergency ? [["suppli-agenda", "Supplementary", Layers] as const] : []),
              ["resolution", "Resolution", FileCheck],
              ["resolution-status", "Status", ClipboardCheck],
            ] as const).map(([val, label, Icon]) => (
              <button
                key={val}
                onClick={() => {
                  setDocType(val as DocType);
                  cancelEdit();
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md font-semibold transition-colors ${
                  docType === val
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-foreground hover:bg-card"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Size</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(e.target.value)}
              className="bg-input/20 border border-input rounded px-2 py-1"
            >
              {Object.keys(PAGE_SIZES).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Orientation</span>
            <select
              value={orientation}
              onChange={(e) => setOrientation(e.target.value as any)}
              className="bg-input/20 border border-input rounded px-2 py-1"
            >
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </label>

          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Margins&nbsp;(mm)</span>
            {(["top", "right", "bottom", "left"] as const).map((side) => (
              <input
                key={side}
                type="number"
                min={0}
                max={60}
                title={side}
                value={margins[side]}
                onChange={(e) => setMargins((m) => ({ ...m, [side]: Number(e.target.value) }))}
                className="w-14 bg-input/20 border border-input rounded px-1.5 py-1"
              />
            ))}
          </div>

          <label className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Text&nbsp;size</span>
            <input
              type="number"
              min={70}
              max={160}
              step={5}
              value={scalePct}
              onChange={(e) => setScalePct(Number(e.target.value))}
              className="w-16 bg-input/20 border border-input rounded px-1.5 py-1"
            />
            <span className="text-muted-foreground">%</span>
          </label>

          <label className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Line&nbsp;height</span>
            <input
              type="number"
              min={1}
              max={3}
              step={0.1}
              placeholder="auto"
              value={lineHeight}
              onChange={(e) => setLineHeight(e.target.value === "" ? "" : Number(e.target.value))}
              className="w-16 bg-input/20 border border-input rounded px-1.5 py-1"
            />
          </label>
        </div>
      </div>

      {/* Preview area. "pdf" mode renders the real generated PDF (exactly what
          downloads / prints); "edit" mode is the inline-editing grid. */}
      {previewMode === "pdf" ? (
        <div className="flex-1 min-h-0 relative bg-muted/40">
          {pdfPreviewUrl && (
            <iframe
              title="PDF preview"
              src={`${pdfPreviewUrl}#toolbar=0&navpanes=0&view=FitH`}
              className="absolute inset-0 h-full w-full border-0 bg-white"
            />
          )}
          {pdfPreviewLoading && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/60 text-sm text-muted-foreground backdrop-blur-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Rendering PDF…
            </div>
          )}
          {pdfPreviewError && !pdfPreviewLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-destructive">
              {pdfPreviewError}
              <button
                onClick={() => setPreviewNonce((n) => n + 1)}
                className="rounded-md border border-input px-3 py-1 text-xs text-foreground hover:bg-muted"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      ) : (
      <div className="flex-1 overflow-auto p-6">
        <div
          id="pdf-print-root"
          className="mx-auto bg-white text-black shadow-lg"
          style={{
            width: `${paperW}mm`,
            minHeight: `${paperH}mm`,
            paddingTop: `${margins.top}mm`,
            paddingRight: `${margins.right}mm`,
            paddingBottom: `${margins.bottom}mm`,
            paddingLeft: `${margins.left}mm`,
          }}
        >
          <div
            style={{
              zoom: scalePct / 100,
              lineHeight: lineHeight === "" ? undefined : lineHeight,
              fontFamily: "'Kalpurush', 'PrimaryFont', serif",
            }}
          >
            {/* Document title block — computed identically to the generated PDF. */}
            <div className="text-center font-bold mb-5 leading-snug">
              {heading.university && (
                <div className="text-lg mb-2.5">বাংলাদেশ প্রকৌশল বিশ্ববিদ্যালয়, ঢাকা</div>
              )}
              <div className="underline">{heading.subtitle}</div>
            </div>

            {docType === "resolution" ? (
              <table className="preview-grid w-full border-collapse text-[13px]">
                <tbody>
                  <tr>
                    <td colSpan={3} className="border border-border px-3 py-2">
                      {renderCell(null, "description")}
                    </td>
                  </tr>
                  {resolutionAgendas.map((ag) => (
                    <Fragment key={ag.id}>
                      {agendaRow(ag)}
                      <tr className="align-top">
                        <td className="border border-border px-2 py-1.5 font-bold whitespace-nowrap">
                          সিদ্ধান্তঃ
                        </td>
                        <td colSpan={2} className="border border-border px-3 py-1.5">
                          {renderCell(ag, "resolution")}
                        </td>
                      </tr>
                    </Fragment>
                  ))}
                  <tr>
                    <td colSpan={3} className="border border-border px-3 py-2">
                      {renderCell(null, "conclusion")}
                    </td>
                  </tr>
                </tbody>
              </table>
            ) : docType === "resolution-status" ? (
              <table className="preview-grid w-full border-collapse text-[13px]">
                <thead>
                  <tr className="font-bold text-center">
                    <td className="border border-border px-2 py-1.5 w-[14%]">প্রস্তাব নং</td>
                    <td className="border border-border px-2 py-1.5 w-[36%]">আলোচ্যসূচি</td>
                    <td className="border border-border px-2 py-1.5 w-[35%]">সিদ্ধান্ত</td>
                    <td className="border border-border px-2 py-1.5 w-[15%]">বাস্তবায়ন অবস্থা</td>
                  </tr>
                </thead>
                <tbody>
                  {resolutionAgendas.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-6 text-center text-black/40 italic">
                        No agenda items.
                      </td>
                    </tr>
                  ) : (
                    resolutionAgendas.map((ag) => (
                      <Fragment key={ag.id}>
                        {categoryHeaderRow(ag, 4)}
                        <tr className="align-top">
                          <td className="border border-border px-2 py-1.5 text-center font-bold whitespace-nowrap">
                            {(() => {
                              const clean = stripTags(ag.content || "");
                              const bibidha = !ag.is_suppli && (ag.agenda_serial === 0 || clean.startsWith("বিবিধ"));
                              if (bibidha) return `বিবিধ : ${ac ? ac + " " : ""}${rest}${serialFor(ag)}`;
                              return `${ac ? ac + " " : ""}${rest}${serialFor(ag)}`;
                            })()}
                          </td>
                          <td className="border border-border px-3 py-1.5">
                            {roHtml(ag.content, "(empty)")}
                          </td>
                          <td className="border border-border px-3 py-1.5 font-bold [&_*]:font-bold">
                            {roHtml(ag.resolution, "(empty)")}
                          </td>
                          <td className="border border-border px-2 py-1.5 text-center">
                            {roHtml(statusText(ag), "—")}
                          </td>
                        </tr>
                      </Fragment>
                    ))
                  )}
                </tbody>
              </table>
            ) : (
              <table className="preview-grid w-full border-collapse text-[13px]">
                <tbody>
                  {activeAgendas.length === 0 ? (
                    <tr>
                      <td className="p-6 text-center text-black/40 italic">
                        No {docType === "suppli-agenda" ? "supplementary " : ""}agenda items.
                      </td>
                    </tr>
                  ) : (
                    activeAgendas.map((ag) => agendaRow(ag))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
