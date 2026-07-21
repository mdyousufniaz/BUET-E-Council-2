"use client";

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronsUpDown, Plus, X } from 'lucide-react';

interface Tag {
  id: string;
  name: string;
}

interface TagMultiSelectProps {
  options: Tag[];
  value: string[];
  onChange: (value: string[]) => void;
  onAddNew?: (name: string) => void;
  placeholder?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLElement>) => void;
}

export default function TagMultiSelect({
  options,
  value,
  onChange,
  onAddNew,
  placeholder = "Select tags...",
  onKeyDown
}: TagMultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const updatePosition = () => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDropdownStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
        zIndex: 99999,
      });
    }
  };

  useEffect(() => {
    if (isOpen) {
      updatePosition();
      window.addEventListener('scroll', updatePosition, true);
      window.addEventListener('resize', updatePosition);
    }
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      const isOutsideContainer = containerRef.current && !containerRef.current.contains(target);
      const dropdownElement = document.getElementById('tag-multiselect-dropdown');
      const isOutsideDropdown = dropdownElement ? !dropdownElement.contains(target) : true;

      if (isOutsideContainer && isOutsideDropdown) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredOptions = options.filter(opt =>
    opt.name.toLowerCase().includes(search.toLowerCase())
  );

  const selectedTags = value
    .map(id => options.find(opt => opt.id === id))
    .filter((t): t is Tag => !!t);

  const toggleTag = (id: string) => {
    if (value.includes(id)) {
      onChange(value.filter(v => v !== id));
    } else {
      onChange([...value, id]);
    }
  };

  const removeTag = (id: string) => {
    onChange(value.filter(v => v !== id));
  };

  return (
    <div className="relative" ref={containerRef}>
      <div
        className="flex items-center flex-wrap gap-1.5 min-h-[38px] w-full px-2 py-1.5 bg-input/20 border border-input rounded-md cursor-pointer focus-within:ring-2 focus-within:ring-ring"
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={onKeyDown}
        tabIndex={0}
      >
        {selectedTags.length === 0 && (
          <span className="text-sm text-muted-foreground px-1">{placeholder}</span>
        )}
        {selectedTags.map(tag => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs font-medium px-2 py-1 rounded-full"
          >
            {tag.name}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeTag(tag.id); }}
              className="hover:text-destructive"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <ChevronsUpDown className="w-4 h-4 opacity-50 ml-auto shrink-0" />
      </div>

      {isOpen && mounted && typeof document !== 'undefined' && createPortal(
        <div id="tag-multiselect-dropdown" style={dropdownStyle} className="bg-popover text-popover-foreground border border-border rounded-md shadow-xl flex flex-col overflow-hidden">
          <div className="p-2 border-b border-border/50 shrink-0 bg-popover">
            <input
              type="text"
              className="w-full px-2 py-1.5 text-sm bg-input/20 border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Search tags..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={onKeyDown}
              autoFocus
            />
          </div>
          <div className="max-h-60 overflow-y-auto p-1 bg-popover">
            {filteredOptions.length === 0 ? (
              <div className="py-3 px-2 text-sm text-muted-foreground text-center">No tags found.</div>
            ) : (
              filteredOptions.map((opt) => (
                <div
                  key={opt.id}
                  className={`flex items-center px-2 py-2 text-sm rounded-sm cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors ${value.includes(opt.id) ? 'bg-accent/50 font-medium text-foreground' : 'text-muted-foreground'}`}
                  onClick={() => toggleTag(opt.id)}
                >
                  <Check className={`w-4 h-4 mr-2 ${value.includes(opt.id) ? 'opacity-100 text-primary' : 'opacity-0'}`} />
                  {opt.name}
                </div>
              ))
            )}
          </div>

          {onAddNew && search && !options.find(opt => opt.name.toLowerCase() === search.toLowerCase()) && (
            <div
              className="p-2.5 border-t border-border/50 bg-muted/30 cursor-pointer hover:bg-accent transition-colors text-sm flex items-center text-primary font-medium shrink-0"
              onClick={() => {
                onAddNew(search);
                setSearch('');
              }}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add "{search}"
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
