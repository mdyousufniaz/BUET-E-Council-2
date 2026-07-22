"use client";

import { useState, useRef } from "react";
import { FileText, FileCheck, Users, Loader2, Upload, Download, Eye } from "lucide-react";
import api from "../../lib/api";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { useAuth } from "../../hooks/useAuth";
import { canOperateMeeting } from "../../lib/meetingAccess";

export default function MaterialsView({ meeting }: { meeting: any }) {
  const { user } = useAuth();
  const canEdit = canOperateMeeting(user, meeting);
  const [generating, setGenerating] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadType, setUploadType] = useState<string | null>(null);
  const { mutate } = useSWRConfig();
  const readOnly = !canEdit;

  const handleGenerate = async (type: string, filename: string) => {
    setGenerating(type);
    try {
      const response = await api.get(`/meetings/${meeting.id}/pdf/${type}`, {
        responseType: 'blob'
      });
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${filename}-${meeting.title}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
    } catch (err) {
      toast.error(`Failed to generate ${type} PDF.`);
    } finally {
      setGenerating(null);
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

  const triggerUpload = (type: string) => {
    setUploadType(type);
    setTimeout(() => {
      fileInputRef.current?.click();
    }, 0);
  };

  return (
    <div className="max-w-5xl animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-2xl font-bold">Meeting Materials</h2>
      </div>

      <input 
        type="file" 
        accept="application/pdf" 
        className="hidden" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
      />

      <div className="mb-10">
        <h3 className="text-lg font-semibold mb-4 border-b border-border pb-2">Generate System PDFs</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        
        {/* Generate Agenda PDF */}
        <div 
          onClick={() => !generating && handleGenerate('agenda', 'Agenda')}
          className={`bg-card border-2 border-border hover:border-primary cursor-pointer p-8 rounded-xl flex flex-col items-center justify-center gap-4 transition-all hover:shadow-md ${generating === 'agenda' ? 'opacity-70 pointer-events-none' : ''}`}
        >
          {generating === 'agenda' ? (
            <Loader2 className="w-12 h-12 text-primary animate-spin" />
          ) : (
            <FileText className="w-12 h-12 text-foreground group-hover:text-primary transition-colors" />
          )}
          <h3 className="text-foreground font-semibold text-center">Generate Agenda PDF</h3>
        </div>

        {/* Generate Resolution PDF */}
        <div 
          onClick={() => !generating && handleGenerate('resolution', 'Resolution')}
          className={`bg-card border-2 border-border hover:border-primary cursor-pointer p-8 rounded-xl flex flex-col items-center justify-center gap-4 transition-all hover:shadow-md ${generating === 'resolution' ? 'opacity-70 pointer-events-none' : ''}`}
        >
          {generating === 'resolution' ? (
            <Loader2 className="w-12 h-12 text-primary animate-spin" />
          ) : (
            <FileCheck className="w-12 h-12 text-foreground group-hover:text-primary transition-colors" />
          )}
          <h3 className="text-foreground font-semibold text-center">Generate Resolution PDF</h3>
        </div>

        {/* Generate Attendance Sheet */}
        <div 
          onClick={() => !generating && handleGenerate('attendance', 'Attendance')}
          className={`bg-card border-2 border-border hover:border-primary cursor-pointer p-8 rounded-xl flex flex-col items-center justify-center gap-4 transition-all hover:shadow-md ${generating === 'attendance' ? 'opacity-70 pointer-events-none' : ''}`}
        >
          {generating === 'attendance' ? (
            <Loader2 className="w-12 h-12 text-primary animate-spin" />
          ) : (
            <Users className="w-12 h-12 text-foreground group-hover:text-primary transition-colors" />
          )}
          <h3 className="text-foreground font-semibold text-center">Generate Attendance Sheet</h3>
        </div>

        {/* Generate Resolution Status PDF */}
        <div 
          onClick={() => !generating && handleGenerate('resolution-status', 'Resolution_Status')}
          className={`bg-card border-2 border-border hover:border-emerald-500 cursor-pointer p-6 rounded-xl flex flex-col items-center justify-center gap-3 transition-all hover:shadow-md ${generating === 'resolution-status' ? 'opacity-70 pointer-events-none' : ''}`}
        >
          {generating === 'resolution-status' ? (
            <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
          ) : (
            <FileCheck className="w-10 h-10 text-foreground group-hover:text-emerald-500 transition-colors" />
          )}
          <h3 className="text-foreground font-semibold text-center text-sm">Generate Resolution Status PDF</h3>
        </div>

      </div>
      </div>

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
              <a href={`/storage/${meeting.agenda_pdf_link}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-blue-600 hover:underline bg-blue-50 p-3 rounded-md">
                <Eye className="w-4 h-4" /> View Current PDF
              </a>
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

          {/* Upload Resolution PDF */}
          <div className="bg-card border border-border p-6 rounded-xl shadow-sm flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 p-3 rounded-lg">
                <FileCheck className="w-6 h-6 text-primary" />
              </div>
              <h3 className="font-semibold">Signed Resolution</h3>
            </div>
            {meeting.resolution_pdf_link ? (
              <a href={`/storage/${meeting.resolution_pdf_link}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-blue-600 hover:underline bg-blue-50 p-3 rounded-md">
                <Eye className="w-4 h-4" /> View Current PDF
              </a>
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

          {/* Upload Resolution Status PDF */}
          <div className="bg-card border border-border p-6 rounded-xl shadow-sm flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="bg-emerald-500/10 p-3 rounded-lg">
                <FileCheck className="w-6 h-6 text-emerald-600" />
              </div>
              <h3 className="font-semibold">Signed Resolution Status</h3>
            </div>
            {meeting.resolution_status_pdf_link ? (
              <a href={`/storage/${meeting.resolution_status_pdf_link}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-blue-600 hover:underline bg-blue-50 p-3 rounded-md">
                <Eye className="w-4 h-4" /> View Current PDF
              </a>
            ) : (
              <div className="text-sm text-muted-foreground italic bg-muted/50 p-3 rounded-md">No PDF uploaded yet</div>
            )}
            {!readOnly && (
              <button 
                onClick={() => triggerUpload('resolution-status')}
                disabled={uploading === 'resolution-status'}
                className="mt-auto flex items-center justify-center gap-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 py-2 px-4 rounded-md font-medium text-sm transition-colors"
              >
                {uploading === 'resolution-status' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {meeting.resolution_status_pdf_link ? "Replace PDF" : "Upload PDF"}
              </button>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
