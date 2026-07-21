"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Users, Building2, Briefcase, Calendar,
  Settings, Shield, LogOut, LayoutGrid, FileText, ScrollText
} from 'lucide-react';
import type { Role } from '../hooks/useAuth';

interface SidebarProps {
  type?: 'admin' | 'profile';
  role?: Role | null;
  // Mobile off-canvas drawer control; ignored (always visible) at md+ widths.
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ type = 'admin', role, isOpen = false, onClose }: SidebarProps) {
  const pathname = usePathname();

  const adminLinks = [
    { name: 'Meetings', href: '/admin/meetings', icon: Calendar },
    { name: 'Templates', href: '/admin/templates', icon: FileText },
    { name: 'Members', href: '/admin/members', icon: Users },
    { name: 'Faculties', href: '/admin/faculties', icon: Building2 },
    { name: 'Departments', href: '/admin/departments', icon: Briefcase },
    { name: 'Offices', href: '/admin/offices', icon: Building2 },
    // User management and the audit log are admin-only.
    ...(role === 'admin' || role === 'superadmin' ? [
      { name: 'Users', href: '/admin/users', icon: Users },
      { name: 'Audit Log', href: '/admin/audit-log', icon: ScrollText },
    ] : []),
  ];

  const profileLinks = [
    { name: 'Profile', href: '/profile', icon: Settings },
    { name: 'Sessions', href: '/profile/sessions', icon: Shield },
  ];

  const links = type === 'admin' ? adminLinks : profileLinks;

  // Prefer an exact match when one exists (e.g. /profile/sessions matches
  // "Sessions" exactly), so a shorter sibling href like /profile doesn't
  // also light up via prefix-matching. Only fall back to prefix-matching
  // (for nested routes like /admin/meetings/<id>) when nothing matches exactly.
  const hasExactMatch = links.some(l => l.href === pathname);
  const isLinkActive = (href: string) =>
    hasExactMatch ? href === pathname : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      {/* Backdrop, mobile only, shown while the drawer is open */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-sidebar border-r border-sidebar-border flex-shrink-0 transform transition-transform duration-200 ease-in-out
          md:static md:z-auto md:min-h-[calc(100vh-4rem)] md:translate-x-0
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="p-4 space-y-2">
          {links.map((link) => {
            const isActive = isLinkActive(link.href);
            const Icon = link.icon;

            return (
              <Link
                key={link.name}
                href={link.href}
                onClick={onClose}
                className={`flex items-center space-x-3 px-3 py-2 rounded-md transition-colors ${
                  isActive
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground font-medium'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span>{link.name}</span>
              </Link>
            );
          })}
        </div>
      </aside>
    </>
  );
}
