"use client";

import { useTheme } from "next-themes";
import { Palette, Check, Sun, Moon, Sparkles } from "lucide-react";
import { useEffect, useState, useRef } from "react";

const THEMES = [
  {
    id: "maroon",
    name: "BUET Maroon",
    description: "Classic Maroon & Cream",
    color: "#800000",
    bgClass: "bg-[#800000]",
    badge: "Default"
  },
  {
    id: "blue",
    name: "Ocean Blue",
    description: "White & Blue Accent",
    color: "#2563eb",
    bgClass: "bg-[#2563eb]",
    badge: "Popular"
  },
  {
    id: "monochrome",
    name: "Monochrome",
    description: "White & Black Minimal",
    color: "#09090b",
    bgClass: "bg-[#09090b]",
    badge: "Clean"
  },
  {
    id: "forest",
    name: "Forest Green",
    description: "Fresh Green & White",
    color: "#15803d",
    bgClass: "bg-[#15803d]",
    badge: "New"
  },
  {
    id: "purple",
    name: "Royal Purple",
    description: "Rich Violet Accent",
    color: "#7c3aed",
    bgClass: "bg-[#7c3aed]",
    badge: "New"
  },
  {
    id: "amber",
    name: "Sunset Amber",
    description: "Warm Amber & Cream",
    color: "#d97706",
    bgClass: "bg-[#d97706]",
    badge: "New"
  },
  {
    id: "dark",
    name: "Midnight Dark",
    description: "Dark Crimson & Night",
    color: "#c45c5c",
    bgClass: "bg-[#c45c5c]",
    badge: "Night"
  }
];

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  if (!mounted) {
    return (
      <button className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 text-primary border border-primary/20 opacity-50 cursor-not-allowed">
        <Palette className="w-5 h-5" />
      </button>
    );
  }

  const activeTheme = THEMES.find(t => t.id === theme) || THEMES[0];

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-card hover:bg-muted transition-all border border-border text-foreground shadow-xs cursor-pointer"
        aria-label="Select theme"
        title="Choose Application Theme"
      >
        <span className={`w-3.5 h-3.5 rounded-full ${activeTheme.bgClass} shadow-xs ring-2 ring-background`} />
        <span className="text-xs font-semibold hidden sm:inline">{activeTheme.name}</span>
        <Palette className="w-4 h-4 text-muted-foreground" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-popover text-popover-foreground border border-border rounded-2xl shadow-xl p-2 z-[100000] animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="px-3 py-2 border-b border-border mb-1 flex items-center justify-between">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-primary" /> Select Theme
            </span>
          </div>

          <div className="flex flex-col gap-1">
            {THEMES.map((t) => {
              const isActive = theme === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    setTheme(t.id);
                    setIsOpen(false);
                  }}
                  className={`flex items-center justify-between p-2.5 rounded-xl text-left transition-all cursor-pointer ${
                    isActive
                      ? "bg-primary/15 text-primary font-bold border border-primary/30 shadow-2xs"
                      : "hover:bg-muted text-foreground"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="w-4 h-4 rounded-full flex-shrink-0 shadow-xs ring-2 ring-background"
                      style={{ backgroundColor: t.color }}
                    />
                    <div>
                      <div className="text-xs font-semibold leading-none flex items-center gap-1.5">
                        {t.name}
                        {t.badge && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary uppercase">
                            {t.badge}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5 font-normal">
                        {t.description}
                      </div>
                    </div>
                  </div>
                  {isActive && <Check className="w-4 h-4 text-primary shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
