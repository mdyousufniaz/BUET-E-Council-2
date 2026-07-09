"use client";

import { usePathname, useRouter } from "next/navigation";
import { Menu } from "lucide-react";
import Sidebar from "./Sidebar";
import { useAuth } from "../hooks/useAuth";
import { useEffect, useState } from "react";

export default function AdminLayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { role, error, isLoading } = useAuth();

  useEffect(() => {
    if (error) {
      router.push('/login');
    }
  }, [error, router]);

  if (isLoading || !role) {
    return <div className="flex flex-1 items-center justify-center min-h-screen">Loading...</div>;
  }

  // Check if we are inside a specific meeting's workspace
  // Matches /admin/meetings/uuid or any other ID, but NOT /admin/meetings directly.
  const isMeetingWorkspace = /^\/admin\/meetings\/[^\/]+$/.test(pathname || "");

  if (isMeetingWorkspace) {
    return (
      <div className="flex flex-1 overflow-hidden">
        {children}
      </div>
    );
  }

  // Standard Admin Layout
  return (
    <div className="flex flex-1 overflow-hidden">
      <Sidebar type="admin" role={role} isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-8 bg-background">
        <button
          onClick={() => setSidebarOpen(true)}
          className="md:hidden mb-4 p-2 -ml-2 text-foreground hover:bg-accent rounded-md"
          aria-label="Open menu"
        >
          <Menu className="w-6 h-6" />
        </button>
        {children}
      </main>
    </div>
  );
}
