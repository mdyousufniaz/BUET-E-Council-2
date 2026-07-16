"use client";

import { usePathname, useRouter } from "next/navigation";
import Sidebar from "./Sidebar";
import SidebarToggleButton from "./SidebarToggleButton";
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
    } else if (role === 'viewer') {
      // Viewers get a read-only equivalent under /viewer instead of the
      // admin management UI.
      router.push('/viewer/meetings');
    }
  }, [error, role, router]);

  if (isLoading || !role || role === 'viewer') {
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
        <SidebarToggleButton isOpen={sidebarOpen} onClick={() => setSidebarOpen(prev => !prev)} />
        {children}
      </main>
    </div>
  );
}
