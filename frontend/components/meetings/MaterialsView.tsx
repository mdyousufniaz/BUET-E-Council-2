"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { FileText, FileCheck, Users, Loader2, Upload, Download, Eye, Trash2, LayoutTemplate, Layers } from "lucide-react";
import api, { getTabSessionToken } from "../../lib/api";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { useAuth } from "../../hooks/useAuth";
import { canOperateMeeting } from "../../lib/meetingAccess";
import AttendanceSheetOptionsModal from "./AttendanceSheetOptionsModal";

export default function MaterialsView({ meeting }: { meeting: any }) {
  const { user } = useAuth();
  const canEdit = canOperateMeeting(user, meeting);
  const token = typeof window !== 'undefined' ? getTabSessionToken() : null;
  const [generating, setGenerating] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadType, setUploadType] = useState<string | null>(null);
  const { mutate } = useSWRConfig();
  const readOnly = !canEdit;
  const [isAttendanceModalOpen, setIsAttendanceModalOpen] = useState(false);

  const handleGenerate = async (
    type: string,
    filename: string,
    format: 'pdf' | 'docx' = 'pdf',
    params?: Record<string, any>
  ) => {
    const key = `${type}-${format}${params?.separatePages ? '-separate' : ''}`;
    setGenerating(key);
    try {
      const ext = format === 'docx' ? 'docx' : 'pdf';
      const response = await api.get(`/meetings/${meeting.id}/${format}/${type}`, {
        params,
        responseType: 'blob'
      });
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${filename}-${meeting.title}.${ext}`);
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
    } catch (err) {
      toast.error(`Failed to generate ${type} ${format.toUpperCase()}.`);
    } finally {
      setGenerating(null);
    }
  };

  const handleGenerateAttendance = async (mode: 'all' | 'separate', selectedGroups: string[], format: 'pdf' | 'docx' = 'pdf') => {
    const ext = format === 'docx' ? 'docx' : 'pdf';
    if (mode === 'all') {
      await handleGenerate('attendance', 'Attendance', format);
    } else {
      // Generate separate files for each selected group
      for (const group of selectedGroups) {
        setGenerating(`attendance-${group}-${format}`);
        try {
          const response = await api.get(`/meetings/${meeting.id}/${format}/attendance`, {
            params: { group },
            responseType: 'blob'
          });
          
          const url = window.URL.createObjectURL(new Blob([response.data]));
          const link = document.createElement('a');
          link.href = url;
          const groupLabel = group.startsWith('dept:') 
            ? group.replace('dept:', '').replace(/\s+/g, '_')
            : group;
          link.setAttribute('download', `Attendance_${groupLabel}-${meeting.title}.${ext}`);
          document.body.appendChild(link);
          link.click();
          link.parentNode?.removeChild(link);
          
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (err) {
          toast.error(`Failed to generate ${format.toUpperCase()} for ${group}.`);
        } finally {
          setGenerating(null);
        }
      }
      toast.success(`Generated ${selectedGroups.length} attendance ${format.toUpperCase()} file(s)`);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadType) return;
    
    if (file.type !== 'application/pdf') {
      toast.error('Only PDF files are allowed');
      return;
    }

    setUploading(uploadType);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', uploadType);

    try {
      await api.post(`/meetings/${meeting.id}/materials/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      toast.success(`${uploadType.replace('-', ' ')} uploaded successfully!`);
      mutate(`/meetings/${meeting.id}`);
    } catch (err) {
      toast.error(`Failed to upload ${uploadType.replace('-', ' ')}.`);
    } finally {
      setUploading(null);
      setUploadType(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteMaterial = async (type: string) => {
    if (!confirm(`Are you sure you want to delete the signed ${type.replace('-', ' ')} PDF?`)) return;
    setDeleting(type);
    try {
      await api.delete(`/meetings/${meeting.id}/materials/${type}`);
      toast.success(`Signed ${type.replace('-', ' ')} PDF deleted successfully`);
      mutate(`/meetings/${meeting.id}`);
    } catch (err) {
      toast.error(`Failed to delete signed ${type.replace('-', ' ')} PDF.`);
    } finally {
      setDeleting(null);
    }
  };

  const triggerUpload = (type: string) => {
    setUploadType(type);
    setTimeout(() => {
      fileInputRef.current?.click();
    }, 0);
  };

  return (
    <div className="max-w-5xl animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
      <div className="flex justify-between items-center mb-8 gap-4">
        <h2 className="text-2xl font-bold">Meeting Materials</h2>
        <Link
          href={`/workspace/meetings/${meeting.id}/pdf-preview`}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-primary/10 text-primary hover:bg-primary/20 rounded-lg transition-colors shrink-0"
        >
          <LayoutTemplate className="w-4 h-4" />
          Preview &amp; Layout
        </Link>
      </div>

      <input 
        type="file" 
        accept="application/pdf" 
        className="hidden" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
      />

      {/* Section 1: Generate System Documents */}
      <div className="mb-10">
        <h3 className="text-lg font-semibold mb-4 border-b border-border pb-2">Generate System Documents</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        
          {/* Agenda Card */}
          <div className="bg-card border border-border p-5 rounded-xl shadow-sm flex flex-col justify-between gap-4 hover:border-primary/50 transition-all">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 p-3 rounded-lg text-primary">
                <FileText className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground text-base">Agenda Document</h3>
                <p className="text-xs text-muted-foreground">Standard meeting agendas</p>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <button
                onClick={() => handleGenerate('agenda', 'Agenda', 'pdf')}
                disabled={!!generating}
                className="flex-1 flex items-center justify-center gap-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 py-2 px-3 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {generating === 'agenda-pdf' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                PDF
              </button>
              <button
                onClick={() => handleGenerate('agenda', 'Agenda', 'docx')}
                disabled={!!generating}
                className="flex-1 flex items-center justify-center gap-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 py-2 px-3 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {generating === 'agenda-docx' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                Word (.docx)
              </button>
            </div>
          </div>

          {/* Supplementary Agenda Card */}
          {meeting.is_regular !== false && (
            <div className="bg-card border border-border p-5 rounded-xl shadow-sm flex flex-col justify-between gap-4 hover:border-amber-500/50 transition-all">
              <div className="flex items-center gap-3">
                <div className="bg-amber-500/10 p-3 rounded-lg text-amber-500">
                  <FileText className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground text-base">Supplementary Agenda</h3>
                  <p className="text-xs text-muted-foreground">Additional agenda items</p>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <button
                  onClick={() => handleGenerate('suppli-agenda', 'Supplementary_Agenda', 'pdf')}
                  disabled={!!generating}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 py-2 px-3 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  {generating === 'suppli-agenda-pdf' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                  PDF
                </button>
                <button
                  onClick={() => handleGenerate('suppli-agenda', 'Supplementary_Agenda', 'docx')}
                  disabled={!!generating}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 py-2 px-3 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  {generating === 'suppli-agenda-docx' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  Word (.docx)
                </button>
              </div>
            </div>
          )}

          {/* Resolution Card */}
          <div className="bg-card border border-border p-5 rounded-xl shadow-sm flex flex-col justify-between gap-4 hover:border-primary/50 transition-all">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 p-3 rounded-lg text-primary">
                <FileCheck className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground text-base">Resolution Document</h3>
                <p className="text-xs text-muted-foreground">Final approved resolutions</p>
              </div>
            </div>
            <div className="space-y-2 mt-1">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleGenerate('resolution', 'Resolution', 'pdf')}
                  disabled={!!generating}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 py-2 px-3 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                  title="Generate standard continuous PDF"
                >
                  {generating === 'resolution-pdf' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileCheck className="w-3.5 h-3.5" />}
                  PDF
                </button>
                <button
                  onClick={() => handleGenerate('resolution', 'Resolution', 'docx')}
                  disabled={!!generating}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 py-2 px-3 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  {generating === 'resolution-docx' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  Word (.docx)
                </button>
              </div>
              <button
                onClick={() => handleGenerate('resolution', 'Resolution_Separate_Pages', 'pdf', { separatePages: true })}
                disabled={!!generating}
                className="w-full flex items-center justify-center gap-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 py-1.5 px-3 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                title="Print each resolution on a separate page"
              >
                {generating === 'resolution-pdf-separate' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Layers className="w-3.5 h-3.5" />}
                PDF (Separate Page per Resolution)
              </button>
            </div>
          </div>

          {/* Resolution Status Card */}
          <div className="bg-card border border-border p-5 rounded-xl shadow-sm flex flex-col justify-between gap-4 hover:border-emerald-500/50 transition-all">
            <div className="flex items-center gap-3">
              <div className="bg-emerald-500/10 p-3 rounded-lg text-emerald-500">
                <FileCheck className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground text-base">Resolution Status</h3>
                <p className="text-xs text-muted-foreground">Implementation tracking</p>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <button
                onClick={() => handleGenerate('resolution-status', 'Resolution_Status', 'pdf')}
                disabled={!!generating}
                className="flex-1 flex items-center justify-center gap-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 py-2 px-3 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {generating === 'resolution-status-pdf' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileCheck className="w-3.5 h-3.5" />}
                PDF
              </button>
              <button
                onClick={() => handleGenerate('resolution-status', 'Resolution_Status', 'docx')}
                disabled={!!generating}
                className="flex-1 flex items-center justify-center gap-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 py-2 px-3 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {generating === 'resolution-status-docx' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                Word (.docx)
              </button>
            </div>
          </div>

          {/* Attendance Sheet Card */}
          <div className="bg-card border border-border p-5 rounded-xl shadow-sm flex flex-col justify-between gap-4 hover:border-primary/50 transition-all">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 p-3 rounded-lg text-primary">
                <Users className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground text-base">Attendance Sheet</h3>
                <p className="text-xs text-muted-foreground">Member attendance lists</p>
              </div>
            </div>
            <div className="mt-1">
              <button
                onClick={() => !generating && setIsAttendanceModalOpen(true)}
                disabled={!!generating}
                className="w-full flex items-center justify-center gap-2 bg-primary/10 hover:bg-primary/20 text-primary py-2 px-3 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {generating?.startsWith('attendance') ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Users className="w-3.5 h-3.5" />}
                Configure & Export (PDF / Word)
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* Section 2: Upload & View Signed PDFs */}
      <div className="mb-10">
        <h3 className="text-lg font-semibold mb-4 border-b border-border pb-2">Upload & View Signed PDFs</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Upload Agenda PDF */}
          <div className="bg-card border border-border p-6 rounded-xl shadow-sm flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 p-3 rounded-lg">
                <FileText className="w-6 h-6 text-primary" />
              </div>
              <h3 className="font-semibold">Signed Agenda</h3>
            </div>
            {meeting.agenda_pdf_link ? (
              <div className="flex items-center gap-2">
                <a href={`/storage/${meeting.agenda_pdf_link}${token ? `?token=${token}` : ''}`} target="_blank" rel="noreferrer" className="flex-1 flex items-center gap-2 text-sm text-blue-600 hover:underline bg-blue-50 p-2.5 rounded-md font-medium">
                  <Eye className="w-4 h-4" /> View Current PDF
                </a>
                {!readOnly && (
                  <button
                    onClick={() => handleDeleteMaterial('agenda')}
                    disabled={deleting === 'agenda'}
                    title="Delete Signed PDF"
                    className="p-2.5 text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md transition-colors disabled:opacity-50"
                  >
                    {deleting === 'agenda' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                )}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic bg-muted/50 p-3 rounded-md">No PDF uploaded yet</div>
            )}
            {!readOnly && (
              <button 
                onClick={() => triggerUpload('agenda')}
                disabled={uploading === 'agenda'}
                className="mt-auto flex items-center justify-center gap-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 py-2 px-4 rounded-md font-medium text-sm transition-colors"
              >
                {uploading === 'agenda' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {meeting.agenda_pdf_link ? "Replace PDF" : "Upload PDF"}
              </button>
            )}
          </div>

          {/* Upload Supplementary Agenda PDF */}
          {meeting.is_regular !== false && (
            <div className="bg-card border border-border p-6 rounded-xl shadow-sm flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <div className="bg-amber-500/10 p-3 rounded-lg">
                  <FileText className="w-6 h-6 text-amber-500" />
                </div>
                <h3 className="font-semibold">Signed Supplementary Agenda</h3>
              </div>
              {meeting.suppli_agenda_pdf_link ? (
                <div className="flex items-center gap-2">
                  <a href={`/storage/${meeting.suppli_agenda_pdf_link}${token ? `?token=${token}` : ''}`} target="_blank" rel="noreferrer" className="flex-1 flex items-center gap-2 text-sm text-blue-600 hover:underline bg-blue-50 p-2.5 rounded-md font-medium">
                    <Eye className="w-4 h-4" /> View Current PDF
                  </a>
                  {!readOnly && (
                    <button
                      onClick={() => handleDeleteMaterial('suppli-agenda')}
                      disabled={deleting === 'suppli-agenda'}
                      title="Delete Signed PDF"
                      className="p-2.5 text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md transition-colors disabled:opacity-50"
                    >
                      {deleting === 'suppli-agenda' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  )}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground italic bg-muted/50 p-3 rounded-md">No PDF uploaded yet</div>
              )}
              {!readOnly && (
                <button 
                  onClick={() => triggerUpload('suppli-agenda')}
                  disabled={uploading === 'suppli-agenda'}
                  className="mt-auto flex items-center justify-center gap-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 py-2 px-4 rounded-md font-medium text-sm transition-colors"
                >
                  {uploading === 'suppli-agenda' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  {meeting.suppli_agenda_pdf_link ? "Replace PDF" : "Upload PDF"}
                </button>
              )}
            </div>
          )}

          {/* Upload Resolution PDF */}
          <div className="bg-card border border-border p-6 rounded-xl shadow-sm flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 p-3 rounded-lg">
                <FileCheck className="w-6 h-6 text-primary" />
              </div>
              <h3 className="font-semibold">Signed Resolution</h3>
            </div>
            {meeting.resolution_pdf_link ? (
              <div className="flex items-center gap-2">
                <a href={`/storage/${meeting.resolution_pdf_link}${token ? `?token=${token}` : ''}`} target="_blank" rel="noreferrer" className="flex-1 flex items-center gap-2 text-sm text-blue-600 hover:underline bg-blue-50 p-2.5 rounded-md font-medium">
                  <Eye className="w-4 h-4" /> View Current PDF
                </a>
                {!readOnly && (
                  <button
                    onClick={() => handleDeleteMaterial('resolution')}
                    disabled={deleting === 'resolution'}
                    title="Delete Signed PDF"
                    className="p-2.5 text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md transition-colors disabled:opacity-50"
                  >
                    {deleting === 'resolution' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                )}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic bg-muted/50 p-3 rounded-md">No PDF uploaded yet</div>
            )}
            {!readOnly && (
              <button 
                onClick={() => triggerUpload('resolution')}
                disabled={uploading === 'resolution'}
                className="mt-auto flex items-center justify-center gap-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 py-2 px-4 rounded-md font-medium text-sm transition-colors"
              >
                {uploading === 'resolution' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {meeting.resolution_pdf_link ? "Replace PDF" : "Upload PDF"}
              </button>
            )}
          </div>

        </div>
      </div>

      <AttendanceSheetOptionsModal
        isOpen={isAttendanceModalOpen}
        onClose={() => setIsAttendanceModalOpen(false)}
        meeting={meeting}
        onGenerate={handleGenerateAttendance}
      />
    </div>
  );
}
