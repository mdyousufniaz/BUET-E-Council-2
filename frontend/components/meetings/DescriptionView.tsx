"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import RichTextEditor from "../RichTextEditor";

export default function DescriptionView({ meeting, type, mutate }: { meeting: any, type: string, mutate: any }) {
  const [content, setContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  const title = type === 'description' ? 'Meeting Description' : 'Meeting Conclusion';

  return (
    <div className="max-w-5xl h-full flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
      <div className="flex justify-between items-center mb-6 shrink-0">
        <h2 className="text-2xl font-bold">{title}</h2>
      </div>

      <div className="flex-1 flex flex-col bg-card border border-border rounded-lg shadow-sm overflow-hidden relative">
        <RichTextEditor 
          content={content}
          onChange={(html) => {
            setContent(html);
            setIsDirty(true);
          }}
          className="p-8"
        />

        {/* Action Area */}
        <div className="bg-muted/30 border-t border-border p-4 flex justify-end shrink-0">
          <button 
            disabled={!isDirty}
            className="bg-primary text-primary-foreground hover:opacity-90 px-6 py-2 rounded-md font-medium disabled:opacity-50 transition-opacity flex items-center gap-2 shadow-sm"
          >
            <Save className="w-4 h-4" /> Save {type === 'description' ? 'Description' : 'Conclusion'}
          </button>
        </div>
      </div>
    </div>
  );
}
