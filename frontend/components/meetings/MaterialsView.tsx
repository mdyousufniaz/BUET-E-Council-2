"use client";

import { useState } from "react";
import { FileText, FileCheck, Users, Loader2 } from "lucide-react";
import api from "../../lib/api";
import { toast } from "sonner";

export default function MaterialsView({ meeting }: { meeting: any }) {
  const [generating, setGenerating] = useState<string | null>(null);

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

  return (
    <div className="max-w-4xl animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-2xl font-bold">Meeting Materials</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        
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

      </div>
    </div>
  );
}
