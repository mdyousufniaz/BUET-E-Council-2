"use client";

import { usePathname, useRouter } from "next/navigation";
import Sidebar from "./Sidebar";
import useSWR from "swr";
import { fetcher } from "../lib/api";
import { useEffect } from "react";

export default function AdminLayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  
  const { data: response, error } = useSWR('/auth/me', fetcher);
  
  useEffect(() => {
    if (response?.data?.role === 'member') {
      router.push('/');
    }
  }, [response, router]);

  if (!response) {
    return <div className="flex flex-1 items-center justify-center min-h-screen">Loading...</div>;
  }

  if (response.data?.role === 'member') {
    return null; // Avoid flashing the layout before redirect
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
      <Sidebar type="admin" />
      <main className="flex-1 overflow-y-auto p-8 bg-background">
        {children}
      </main>
    </div>
  );
}
