"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams, useParams } from "next/navigation";
import { FileText, Users, FileCheck, Info, FileBarChart, LayoutList, Layers } from "lucide-react";
import useSWR from "swr";
import { fetcher } from "../../../../lib/api";
import SidebarToggleButton from "../../../../components/SidebarToggleButton";

const navigation = [
  { name: 'Meeting Info', view: 'info', icon: Info },
  { name: 'Description', view: 'description', icon: FileText },
  { name: 'Invitees', view: 'invitees', icon: Users },
  { name: 'Agenda', view: 'agenda', icon: LayoutList },
  { name: 'Supplementary Agenda', view: 'suppli-agenda', icon: Layers },
  { name: 'Resolution', view: 'resolution', icon: FileCheck },
  { name: 'Conclusion', view: 'conclusion', icon: FileText },
  { name: 'Materials', view: 'materials', icon: FileBarChart },
];

export default function MeetingWorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const searchParams = useSearchParams();
  const currentView = searchParams.get('view') || 'info';
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { data: response } = useSWR(`/meetings/${params.id}`, fetcher);
  const meeting = response?.data;

  return (
    <div className="flex flex-1 w-full h-full overflow-hidden">
      {/* Backdrop, mobile only, shown while the drawer is open */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Left Sidebar Navigation specifically for Meeting Workspace */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-sidebar border-r border-sidebar-border flex-shrink-0 flex flex-col transform transition-transform duration-200 ease-in-out
          md:static md:z-auto md:h-full md:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="p-4 border-b border-sidebar-border">
          <Link href="/admin/meetings" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-2">
            ← Back to Meetings
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          {navigation.map((item) => {
            const isActive = currentView === item.view;
            const Icon = item.icon;

            // Dynamically change Invitees to Presentees for past meetings
            let displayName = item.name;
            if (item.view === 'invitees' && meeting?.status === 'past') {
              displayName = 'Presentees';
            }

            return (
              <Link
                key={item.name}
                href={`/admin/meetings/${params.id}?view=${item.view}`}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors ${isActive
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground font-medium shadow-sm'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                  }`}
              >
                <Icon className="w-4 h-4" />
                {displayName}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Main Workspace Area */}
      <main className="flex-1 bg-background overflow-y-auto p-4 sm:p-8 relative">
        <SidebarToggleButton onClick={() => setSidebarOpen(true)} />
        {children}
      </main>
    </div>
  );
}
