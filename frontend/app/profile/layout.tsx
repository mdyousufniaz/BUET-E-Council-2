"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import Header from "../../components/Header";
import Sidebar from "../../components/Sidebar";

export default function ProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar type="profile" isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-8 bg-background">
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden mb-4 p-2 -ml-2 text-foreground hover:bg-accent rounded-md"
            aria-label="Open menu"
          >
            <Menu className="w-6 h-6" />
          </button>
          <div className="max-w-5xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
