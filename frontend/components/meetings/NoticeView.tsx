"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import api, { fetcher } from "../../lib/api";
import RichTextEditor from "../RichTextEditor";
import CustomSelect from "../CustomSelect";
import { toast } from "sonner";
import { useAuth } from "../../hooks/useAuth";
import { Download, Eye, Loader2, Settings, Wand2 } from "lucide-react";
import { toBanglaDigits } from "../../lib/banglaNumerals";
import { sanitizeHtml } from "../../lib/sanitize";

const BANGLA_DAYS = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];
const BANGLA_MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];

const DEFAULT_SIGNATURE = '(অধ্যাপক ড. এন.এম. গোলাম জাকারিয়া)\nরেজিস্ট্রার (অ. দা.)';

function formatNoticeDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${toBanglaDigits(d.getDate())} ${BANGLA_MONTHS[d.getMonth()]} ${toBanglaDigits(d.getFullYear())}`;
}

function formatNoticeDateShort(dateStr: string): string {
  const d = new Date(dateStr);
  const month = d.getMonth() + 1;
  return `${toBanglaDigits(d.getDate())}-${toBanglaDigits(String(month).padStart(2, '0'))}-${toBanglaDigits(d.getFullYear())}`;
}

function getDayName(dateStr: string): string {
  return BANGLA_DAYS[new Date(dateStr).getDay()];
}

function getNoticeTypeOptions(meetingType: string, isRegular: boolean) {
  const allTypes = [
    { value: "invitation", label: "Invitation" },
    { value: "agenda", label: "Agenda" },
    { value: "resolution", label: "Resolution" }
  ];
  if (meetingType === "academic" && !isRegular) {
    return allTypes.filter(t => t.value !== "invitation");
  }
  return allTypes;
}

function getDefaultNoticeType(meetingStatus: string, isRegular: boolean): string {
  if (meetingStatus === "draft") return isRegular ? "invitation" : "agenda";
  if (meetingStatus === "ongoing") return "agenda";
  return "resolution";
}

function generatePrefillBody(
  noticeType: string,
  meetingType: string,
  isRegular: boolean,
  meetingDate: string,
  serialNumber: string,
  meetingId: string,
  onlineMeetingLink?: string
): string {
  const isSyndicate = meetingType === "syndicate";
  const isImmediate = !isRegular;
  const dateStr = formatNoticeDate(meetingDate);
  const dateShort = formatNoticeDateShort(meetingDate);
  const dayName = getDayName(meetingDate);
  const serialNo = (toBanglaDigits(serialNumber) || "Untitled") + " নং";
  const meetingUrl = `${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:9001'}/meetings/${meetingId}`;

  if (isSyndicate) {
    switch (noticeType) {
      case "invitation":
        return `<p>আগামী ${dateStr} তারিখ ${dayName} সিন্ডিকেটের ${serialNo} সভা উপাচার্য মহোদয়ের অফিস কক্ষে অনুষ্ঠিত হবে। উক্ত সিন্ডিকেট সভায় অংশগ্রহণ করার জন্য বিনীতভাবে অনুরোধ করা হলো। সরাসরি উক্ত সিন্ডিকেট সভায় যোগদান করা সম্ভব না হলে ভার্চুয়াল প্ল্যাটফর্মে অংশগ্রহণ করা যাবে।</p><p>এতদসংক্রান্ত আলোচ্যসূচী ও প্রয়োজনীয় তথ্যাদি (সভার আলোচ্যসূচীর ওয়েব লিংক, Zoom Meeting এর ওয়েব লিংক, ID ও Password) শীঘ্রই e-mail এর মাধ্যমে প্রেরণ করা হবে।</p>`;
      case "agenda":
        return `<p>আগামী ${dateStr} তারিখ ${dayName} সিন্ডিকেটের ${serialNo} সভা সরাসরি মাননীয় উপাচার্য মহোদয়ের অফিসে ও ভার্চুয়াল (Hybrid) প্ল্যাটফর্মে অনুষ্ঠিত হবে। উক্ত সভার আলোচ্যসূচীর ওয়েব লিংক, Zoom Meeting এর ওয়েব লিংক, ID ও Password নিম্নে প্রেরণ করা হলো।</p><p><b>• Web link for Agenda and Annexure:</b></p><p><a href="${meetingUrl}">${meetingUrl}</a></p><p>• Web link for Zoom Meeting :</p><p>${onlineMeetingLink || ''}</p><p>Meeting ID : </p><p>Password : </p>`;
      case "resolution":
        return `<p>গত ${dateShort} তারিখে সরাসরি ও ভার্চুয়াল (Hybrid) প্ল্যাটফর্মে অনুষ্ঠিত সিন্ডিকেটের ${serialNo} সভার কার্যবিবরণী নিম্নোক্ত ওয়েব লিংক-এর মাধ্যমে প্রেরণ করা হলো।</p><p><b>• Web link for Resolution:</b></p><p><a href="${meetingUrl}">${meetingUrl}</a></p>`;
      default:
        return "";
    }
  } else {
    if (isImmediate) {
      switch (noticeType) {
        case "agenda":
          return `<p>${dateShort} তারিখে কাউন্সিল ভবনে অনুষ্ঠিত একাডেমিক কাউন্সিলের ${serialNo} জরুরী (Immediate) সভার আলোচ্যসূচী ই-মেইলের মাধ্যমে প্রেরণ করা হলো।</p>`;
        case "resolution":
          return `<p>${dateShort} তারিখে কাউন্সিল ভবনে অনুষ্ঠিত একাডেমিক কাউন্সিলের ${serialNo} জরুরী (Immediate) সভার কার্যবিবরণী ই-মেইলের মাধ্যমে প্রেরণ করা হলো।</p>`;
        default:
          return "";
      }
    } else {
      switch (noticeType) {
        case "invitation":
          return `<p>আগামী ${dateStr} তারিখ ${dayName} একাডেমিক কাউন্সিলের ${serialNo} সভা কাউন্সিল ভবনে অনুষ্ঠিত হবে। উক্ত সভায় অংশগ্রহণ করার জন্য বিনীতভাবে অনুরোধ করা হলো।</p>`;
        case "agenda":
          return `<p>আগামী ${dateStr} তারিখ ${dayName} একাডেমিক কাউন্সিলের ${serialNo} সভা কাউন্সিল ভবনে অনুষ্ঠিত হবে। উক্ত সভার আলোচ্যসূচীর ওয়েব লিংক নিম্নে প্রেরণ করা হলো।</p><p><b>• Web link for Agenda and Annexure:</b></p><p><a href="${meetingUrl}">${meetingUrl}</a></p>`;
        case "resolution":
          return `<p>গত ${dateShort} তারিখে কাউন্সিল ভবনে অনুষ্ঠিত একাডেমিক কাউন্সিলের ${serialNo} সভার কার্যবিবরণী নিম্নোক্ত ওয়েব লিংক-এর মাধ্যমে প্রেরণ করা হলো:</p><p><b>• Web link for Resolution and Annexure:</b></p><p><a href="${meetingUrl}">${meetingUrl}</a></p>`;
        default:
          return "";
      }
    }
  }
}

export default function NoticeView({ meeting, mutate }: { meeting: any, mutate: any }) {
  const { user } = useAuth();
  const { data: sigRes, mutate: mutateSig } = useSWR('/notices/settings/signatures', fetcher, {
    shouldRetryOnError: false, revalidateOnFocus: false
  });

  const { data: inviteesRes } = useSWR(
    meeting.id ? `/meetings/${meeting.id}/invitees` : null,
    fetcher,
    { shouldRetryOnError: false, revalidateOnFocus: false }
  );

  const signatures = sigRes?.data || {};
  const invitees = inviteesRes?.data || [];

  const isSyndicate = (meeting.type || '').toLowerCase() === 'syndicate';
  const isRegular = meeting.is_regular !== false;

  const [generating, setGenerating] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showSigModal, setShowSigModal] = useState(false);
  const [sigForm, setSigForm] = useState({ academic_signature_str: '', syndicate_signature_str: '' });

  const defaultSigKey = isSyndicate ? 'syndicate_signature_str' : 'academic_signature_str';
  const defaultSigImageKey = isSyndicate ? 'syndicate_signature_image' : 'academic_signature_image';

  const [uploadingSig, setUploadingSig] = useState(false);

  const [form, setForm] = useState({
    notice_number: "",
    notice_date: new Date().toISOString().split('T')[0],
    notice_type: getDefaultNoticeType(meeting.status || 'draft', isRegular),
    body: "",
    signature_text: "",
    signature_image: ""
  });

  // Initialize form signature from saved signatures on mount
  useEffect(() => {
    setForm(prev => ({
      ...prev,
      signature_text: signatures[defaultSigKey] || DEFAULT_SIGNATURE,
      signature_image: signatures[defaultSigImageKey] || ""
    }));
  }, [signatures, defaultSigKey, defaultSigImageKey]);

  // Sync sigForm when signatures load
  useEffect(() => {
    if (signatures) {
      setSigForm({
        academic_signature_str: signatures.academic_signature_str || DEFAULT_SIGNATURE,
        syndicate_signature_str: signatures.syndicate_signature_str || DEFAULT_SIGNATURE
      });
    }
  }, [signatures]);

  const noticeTypeOptions = getNoticeTypeOptions(meeting.type || 'academic', isRegular);

  const handlePrefill = () => {
    const body = generatePrefillBody(
      form.notice_type,
      meeting.type || 'academic',
      isRegular,
      meeting.meeting_date,
      meeting.title,
      meeting.id,
      meeting.online_meeting_link
    );
    setForm(prev => ({ ...prev, body }));
    toast.success("Body prefilled with default template");
  };

  const handleDownloadPdf = async () => {
    setGenerating(true);
    try {
      const res = await api.post('/notices/generate-pdf', {
        meeting_id: meeting.id,
        notice_number: form.notice_number,
        notice_date: new Date(form.notice_date).toISOString(),
        notice_type: form.notice_type,
        body: form.body,
        signature_text: form.signature_text,
        signature_image: form.signature_image
      }, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `notice-${form.notice_type}-${meeting.meeting_title || 'meeting'}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success("PDF downloaded");
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to generate PDF");
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveSignature = async () => {
    try {
      await api.put('/notices/settings/signatures', {
        academic_signature_str: sigForm.academic_signature_str,
        syndicate_signature_str: sigForm.syndicate_signature_str,
        academic_signature_image: signatures.academic_signature_image,
        syndicate_signature_image: signatures.syndicate_signature_image
      });
      mutateSig();
      toast.success("Signatures saved permanently");
      setShowSigModal(false);
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to save signatures");
    }
  };

  const handleUploadDefaultSigImage = async (file: File) => {
    const type = isSyndicate ? 'syndicate' : 'academic';
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);
    setUploadingSig(true);
    try {
      const res = await api.post('/notices/settings/signatures/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      mutateSig();
      setForm(prev => ({ ...prev, signature_image: res.data.image_key }));
      toast.success("Signature image uploaded");
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Upload failed");
    } finally {
      setUploadingSig(false);
    }
  };

  const handleRemoveDefaultSigImage = async () => {
    const keyToClear = isSyndicate ? 'syndicate_signature_image' : 'academic_signature_image';
    try {
      await api.put('/notices/settings/signatures', {
        [keyToClear]: ''
      });
      mutateSig();
      setForm(prev => ({ ...prev, signature_image: '' }));
      toast.success("Signature image removed");
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to remove signature image");
    }
  };

  const buildPreviewHtml = (): string => {
    const dateStr = formatNoticeDate(form.notice_date);
    const serialNo = toBanglaDigits(meeting.title) || 'Untitled';

    const addressHtml = isSyndicate
      ? `<p style="margin-bottom: 20px;">সিন্ডিকেটের সম্মানিত সদস্য<br/>বাংলাদেশ প্রকৌশল বিশ্ববিদ্যালয়<br/>ঢাকা-১০০০ ।</p>`
      : `<p style="margin-bottom: 20px;">একাডেমিক কাউন্সিলের সম্মানিত সদস্য<br/>বাংলাদেশ প্রকৌশল বিশ্ববিদ্যালয়<br/>ঢাকা-১০০০ ।</p>`;

    const secretaryLabel = isSyndicate ? 'সিন্ডিকেটের সচিব।' : 'একাডেমিক কাউন্সিলের সচিব।';

    const sigImageHtml = form.signature_image
      ? `<div style="display: flex; justify-content: flex-end; margin-bottom: 5px;"><img src="/api/storage/${form.signature_image}" style="max-height: 50px; max-width: 150px; object-fit: contain;" /></div>`
      : `<div style="height: 40px;"></div>`;

    // Members list for syndicate notices
    let membersHtml = '';
    if (isSyndicate && invitees.length > 0) {
      const sorted = [...invitees].sort((a: any, b: any) => (a.serial ?? Infinity) - (b.serial ?? Infinity));
      const useMultiColumn = sorted.length >= 16;

      const memberRows = sorted.map((m: any, idx: number) => {
        let displayName = m.name || '';
        let officeDetail = m.office_name || '';
        if (!displayName && officeDetail) {
          const parts = officeDetail.split(',');
          displayName = parts[0].trim();
          officeDetail = parts.slice(1).join(',').trim();
        }
        if (!displayName) displayName = 'Unknown';
        const details: string[] = [];
        if (m.designation) details.push(m.designation);
        if (officeDetail) details.push(officeDetail);
        const detailStr = details.length > 0 ? `<br/>${details.join(', ')}` : '';

        const office = (m.office_name || '').normalize('NFC').trim();
        const isVC = office.includes('উপাচার্য') && !office.includes('উপ-উপাচার্য') && !office.includes('উপউপাচার্য');
        const role = isVC ? 'সভাপতি' : 'সদস্য';

        return `<div style="display: flex; justify-content: space-between; margin-bottom: 8px; break-inside: avoid;">
          <div style="width: 75%;">${toBanglaDigits(idx + 1)}. ${displayName}${detailStr}</div>
          <div style="width: 25%; text-align: right;">${role}</div>
        </div>`;
      }).join('');

      const containerStyle = useMultiColumn
        ? 'column-count: 2; column-gap: 30px; font-size: 12px; margin-top: 10px;'
        : 'font-size: 12px; margin-top: 10px;';

      membersHtml = `
        <div style="margin-top: 20px;">
          <div style="text-decoration: underline; font-weight: bold; margin-bottom: 8px;">বিতরণ : (জ্যেষ্ঠতার ভিত্তিতে নয়)</div>
          <div style="${containerStyle}">
            ${memberRows}
          </div>
        </div>
      `;
    }

    return `
      <div style="font-family: 'Kalpurush', 'Noto Sans Bengali', sans-serif; font-size: 14px; line-height: 1.6; padding: 30px 40px;">
        <div style="font-size: 21px; font-weight: bold; text-align: center; margin-bottom: 30px;">বাংলাদেশ প্রকৌশল বিশ্ববিদ্যালয়, ঢাকা</div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 30px;">
          <span>নম্বর: ${form.notice_number || ''}</span>
          <span>তারিখ: ${dateStr}</span>
        </div>
        ${addressHtml}
        <p>মহোদয়,</p>
        <div style="margin-left: 20px; margin-top: 15px;">${form.body || '<p style="color: #999; font-style: italic;">Body content will appear here...</p>'}</div>
        <div style="margin-top: 30px; display: flex; justify-content: flex-end;">
          <div style="text-align: right;">
            <div>আপনার বিশ্বস্ত,</div>
            ${sigImageHtml}
            <div style="white-space: pre-line; font-size: 13px;">${(form.signature_text || '').replace(/\n/g, '<br/>')}</div>
            <div style="margin-top: 10px; font-size: 13px;">এবং<br/>${secretaryLabel}</div>
          </div>
        </div>
        ${membersHtml}
      </div>
    `;
  };

  return (
    <div className="max-w-4xl animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Notice</h2>
          <p className="text-sm text-muted-foreground">
            Generate and download meeting notices (Invitation, Agenda, Resolution).
          </p>
        </div>
        <button
          onClick={() => setShowSigModal(true)}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors"
        >
          <Settings className="w-4 h-4" /> Signature Settings
        </button>
      </div>

      <div className="bg-card border border-border shadow-sm rounded-lg p-6">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Notice Number</label>
              <input
                value={form.notice_number}
                onChange={e => setForm({...form, notice_number: e.target.value})}
                className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm"
                placeholder="e.g. কাউন্সিল/২০২৬/এসি-২(১৩)/র-৮৪৮৩(২৭৫)"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Notice Date</label>
              <input
                type="date"
                value={form.notice_date}
                onChange={e => setForm({...form, notice_date: e.target.value})}
                className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Notice Type</label>
              <CustomSelect
                options={noticeTypeOptions}
                value={form.notice_type}
                onChange={(val) => setForm({...form, notice_type: val})}
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Body</label>
              <button
                onClick={handlePrefill}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-gradient-to-r from-primary/10 to-primary/5 text-primary border border-primary/20 rounded-md hover:from-primary/20 hover:to-primary/10 transition-all"
              >
                <Wand2 className="w-3.5 h-3.5" />
                Auto-Prefill Template
              </button>
            </div>
            <RichTextEditor
              content={form.body}
              onChange={(val) => setForm({...form, body: val})}
              className="min-h-[250px]"
            />
          </div>

          <div className="space-y-3 pt-2">
            <label className="text-sm font-medium">Notice Signature Card</label>
            <div className="p-4 border border-border bg-muted/20 rounded-lg space-y-3">
              {form.signature_image && (
                <div className="flex items-center justify-between p-3 bg-background border border-border rounded-md">
                  <div className="flex items-center gap-3">
                    <img
                      src={`/api/storage/${form.signature_image}`}
                      alt="Notice Signature Preview"
                      className="h-12 object-contain bg-white border border-input rounded px-2 py-1"
                    />
                    <span className="text-xs text-muted-foreground font-medium">Signature Image Uploaded</span>
                  </div>
                  <button
                    onClick={() => setForm(prev => ({ ...prev, signature_image: '' }))}
                    className="text-xs text-destructive hover:underline"
                  >
                    Remove Image
                  </button>
                </div>
              )}
              <textarea
                value={form.signature_text}
                onChange={e => setForm({...form, signature_text: e.target.value})}
                rows={3}
                className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm text-center resize-none"
                placeholder="(অধ্যাপক ড. এন.এম. গোলাম জাকারিয়া)&#10;রেজিস্ট্রার (অ. দা.)"
              />
              <p className="text-xs text-muted-foreground text-center">
                Click &quot;Signature Settings&quot; to manage global default signature text and image.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setShowPreview(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors"
            >
              <Eye className="w-4 h-4" /> Preview
            </button>
            <button
              onClick={handleDownloadPdf}
              disabled={generating}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Download PDF
            </button>
          </div>
        </div>
      </div>

      {/* Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card w-full max-w-3xl max-h-[90vh] rounded-lg shadow-xl border border-border flex flex-col">
            <div className="flex justify-between items-center p-4 border-b border-border">
              <h3 className="text-lg font-semibold">Notice Preview</h3>
              <button onClick={() => setShowPreview(false)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 bg-white text-foreground">
              <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(buildPreviewHtml()) }} />
            </div>
            <div className="flex justify-end gap-2 p-4 border-t border-border">
              <button onClick={() => setShowPreview(false)} className="px-4 py-2 text-sm bg-muted rounded-md">Close</button>
              <button
                onClick={() => { setShowPreview(false); handleDownloadPdf(); }}
                disabled={generating}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md disabled:opacity-50"
              >
                {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Download PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Signature Settings Modal */}
      {showSigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card w-full max-w-lg rounded-lg shadow-xl border border-border p-6">
            <h3 className="text-lg font-semibold mb-2">Signature Settings</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Set default signature text and image for {isSyndicate ? 'Syndicate' : 'Academic'} notices/emails.
            </p>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {isSyndicate ? 'Syndicate' : 'Academic'} Digital Signature Image
                </label>
                {signatures[defaultSigImageKey] ? (
                  <div className="flex items-center justify-between p-3 border border-border rounded-md bg-muted/20">
                    <img
                      src={`/api/storage/${signatures[defaultSigImageKey]}`}
                      alt="Digital Signature"
                      className="h-12 object-contain bg-white border border-input rounded px-2 py-1"
                    />
                    <div className="flex items-center gap-2">
                      <label className="px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded cursor-pointer hover:bg-secondary/80">
                        {uploadingSig ? 'Uploading...' : 'Change Image'}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/jpg,image/webp"
                          className="hidden"
                          onChange={e => {
                            const file = e.target.files?.[0];
                            if (file) handleUploadDefaultSigImage(file);
                          }}
                        />
                      </label>
                      <button
                        onClick={handleRemoveDefaultSigImage}
                        className="px-2.5 py-1.5 text-xs text-destructive hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center border-2 border-dashed border-input p-4 rounded-md cursor-pointer hover:bg-muted/30 transition-colors">
                    <span className="text-xs text-muted-foreground font-medium mb-1">Upload Signature Image</span>
                    <span className="text-[11px] text-muted-foreground">PNG, JPG, WEBP (Max 5MB)</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp"
                      className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) handleUploadDefaultSigImage(file);
                      }}
                    />
                  </label>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">
                  {isSyndicate ? 'Syndicate' : 'Academic'} Signature Text (Default)
                </label>
                <textarea
                  value={isSyndicate ? sigForm.syndicate_signature_str : sigForm.academic_signature_str}
                  onChange={e => {
                    if (isSyndicate) {
                      setSigForm({...sigForm, syndicate_signature_str: e.target.value});
                    } else {
                      setSigForm({...sigForm, academic_signature_str: e.target.value});
                    }
                  }}
                  rows={4}
                  className="w-full px-3 py-2 bg-input/20 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm text-center resize-none"
                  placeholder={DEFAULT_SIGNATURE}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowSigModal(false)} className="px-4 py-2 text-sm bg-muted rounded-md">Cancel</button>
              <button onClick={handleSaveSignature} className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90">
                Save Permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
