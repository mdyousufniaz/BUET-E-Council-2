"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams, useParams, usePathname } from "next/navigation";
import { FileText, Users, FileCheck, Info, FileBarChart, LayoutList, Layers, History, Mail, ShieldCheck, PenTool, Archive } from "lucide-react";
import useSWR from "swr";
import { fetcher } from "../../../../lib/api";
import SidebarToggleButton from "../../../../components/SidebarToggleButton";
import MeetingWorkflowBar from "../../../../components/meetings/MeetingWorkflowBar";
import { useAuth } from "../../../../hooks/useAuth";

const navigation = [
  { name: 'Meeting Info', view: 'info', icon: Info },
  { name: 'Meeting Permissions', view: 'permissions', icon: ShieldCheck },
  { name: 'Description', view: 'description', icon: FileText },
  { name: 'Invitees', view: 'invitees', icon: Users },
  { name: 'Agenda', view: 'agenda', icon: LayoutList },
  { name: 'Supplementary Agenda', view: 'suppli-agenda', icon: Layers },
  { name: 'Archived Agenda', view: 'archived-agenda', icon: Archive },
  { name: 'Resolution', view: 'resolution', icon: FileCheck },
  { name: 'Conclusion', view: 'conclusion', icon: FileText },
  { name: 'Materials', view: 'materials', icon: FileBarChart },
  { name: 'Email', view: 'email', icon: Mail },
  { name: 'Signed Persona', view: 'signed-persona', icon: PenTool },
];

export default function MeetingWorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const currentView = searchParams.get('view') || 'info';
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // The PDF Preview route is its own full-bleed page — no meeting sidebar/chrome.
  const isFullBleed = pathname?.endsWith('/pdf-preview');

  const { data: response, mutate } = useSWR(`/meetings/${params.id}`, fetcher);
  const { data: rolesRes } = useSWR('/auth/roles', fetcher);
  const allRoles = rolesRes?.data || [];
  const meeting = response?.data;

  const { isAdmin, user } = useAuth();
  const isViewer = user?.role === 'viewer';
  const isPast = meeting?.status === 'past' || meeting?.is_completed === true;

  const isDeputyOrAbove = (() => {
    if (isAdmin) return true;
    if (!user || user.role === 'viewer') return false;
    if (user.role_level === null || user.role_level === undefined) return false;
    const userLvl = Number(user.role_level);
    const deputyRole = allRoles.find((r: any) => r.level_title && r.level_title.toLowerCase().includes("deputy registrar"));
    if (deputyRole && deputyRole.level !== undefined && deputyRole.level !== null) {
      return userLvl >= Number(deputyRole.level);
    }
    return userLvl >= 2;
  })();

  const isEmergencyMeeting = meeting?.is_regular === false;

  let navItems = navigation;
  if (!isDeputyOrAbove) {
    navItems = navItems.filter(item => item.view !== 'permissions');
  }
  if (isEmergencyMeeting) {
    navItems = navItems.filter(item => item.view !== 'suppli-agenda');
  }

  if (isViewer) {
    navItems = [{ name: 'Agenda', view: 'agenda', icon: LayoutList }];
    if (meeting?.is_suppli_visible_to_viewers && !isEmergencyMeeting) {
      navItems.push({ name: 'Supplementary Agenda', view: 'suppli-agenda', icon: Layers });
    }
    if (isPast) {
      navItems.push({ name: 'Resolution', view: 'resolution', icon: FileCheck });
    }
  } else if (isAdmin) {
    navItems = [...navItems, { name: 'History', view: 'history', icon: History }];
  }

  if (isFullBleed) {
    return <div className="flex-1 w-full h-full overflow-hidden">{children}</div>;
  }

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
          <Link href="/workspace/meetings" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-2">
            ← Back to Meetings
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          {navItems.map((item) => {
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
                href={`/workspace/meetings/${params.id}?view=${item.view}`}
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
