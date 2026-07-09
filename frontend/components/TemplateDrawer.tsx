"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import api, { fetcher } from "../lib/api";
import { sanitizeHtml } from "../lib/sanitize";
import { Search, X, Filter } from "lucide-react";
import { toast } from "sonner";

interface TemplateDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  type: 'agendam' | 'resolution' | 'description' | 'conclusion';
  onSelect: (content: string) => void;
}

export default function TemplateDrawer({ isOpen, onClose, type, onSelect }: TemplateDrawerProps) {
  const [scope, setScope] = useState<'all' | 'mine'>('all');
  const [search, setSearch] = useState("");
  
  // Use SWR to fetch templates based on type and scope
  const { data: response, error, mutate } = useSWR(
    isOpen ? `/templates?type=${type}&scope=${scope}` : null,
    fetcher
  );

  const templates = response?.data || [];
  
  // Client-side search filtering (since the API search route might be overkill for this Drawer)
  const filteredTemplates = templates.filter((t: any) => 
    t.text_content && t.text_content.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    if (isOpen) {
      mutate();
    }
  }, [isOpen, scope, mutate]);

  const handleSelect = async (template: any) => {
    try {
      // Increment use count in the background
      api.post(`/templates/${template.id}/use`).catch(e => console.error(e));
      
      onSelect(template.text_content);
      toast.success("Template inserted");
      onClose();
    } catch (err) {
      toast.error("Failed to insert template");
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div 
        className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-card border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        <div className="p-4 border-b border-border shrink-0 flex items-center justify-between">
          <h2 className="text-lg font-bold">Insert Template</h2>
          <button 
            onClick={onClose}
            className="p-2 rounded-md hover:bg-muted text-muted-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 border-b border-border shrink-0 space-y-4 bg-muted/20">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input 
              type="text" 
              placeholder="Search templates..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-input/40 border border-input rounded-md focus:ring-1 focus:ring-ring text-sm"
            />
          </div>

          <div className="flex bg-muted p-1 rounded-md">
            <button 
              onClick={() => setScope('all')}
              className={`flex-1 text-sm py-1.5 rounded-sm font-medium transition-colors ${scope === 'all' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              All Templates
            </button>
            <button 
              onClick={() => setScope('mine')}
              className={`flex-1 text-sm py-1.5 rounded-sm font-medium transition-colors ${scope === 'mine' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              My Templates
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && <div className="text-destructive text-sm p-4 text-center">Failed to load templates.</div>}
          {!response && !error && <div className="text-muted-foreground text-sm p-4 text-center animate-pulse">Loading templates...</div>}
          
          {response && filteredTemplates.length === 0 && (
            <div className="text-center p-8 space-y-3">
              <div className="bg-muted w-12 h-12 rounded-full flex items-center justify-center mx-auto">
                <Filter className="w-6 h-6 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground text-sm">No templates found for this search.</p>
            </div>
          )}

          {filteredTemplates.map((template: any) => (
            <div 
              key={template.id}
              className="border border-border rounded-lg p-4 hover:border-primary/50 hover:bg-accent/30 transition-all cursor-pointer group"
              onClick={() => handleSelect(template)}
            >
              <div className="flex justify-between items-start mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                  {template.visibility === 'public' ? 'Public' : 'Private'}
                </span>
                <span className="text-xs text-muted-foreground font-medium bg-muted px-2 py-0.5 rounded-full">
                  Used: {template.used_count || 0}
                </span>
              </div>
              <div 
                className="text-sm text-foreground prose prose-sm dark:prose-invert max-w-none line-clamp-4 overflow-hidden relative"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(template.text_content) }}
              />
              
              <div className="mt-3 pt-3 border-t border-border/50 text-center">
                <span className="text-xs font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                  Click to Insert
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
