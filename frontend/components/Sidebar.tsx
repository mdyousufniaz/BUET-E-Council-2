"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  Users, Building2, Briefcase, Calendar, 
  Settings, Shield, LogOut, LayoutGrid, FileText
} from 'lucide-react';

interface SidebarProps {
  type?: 'admin' | 'profile';
}

export default function Sidebar({ type = 'admin' }: SidebarProps) {
  const pathname = usePathname();

  const adminLinks = [
    { name: 'Meetings', href: '/admin/meetings', icon: Calendar },
    { name: 'Templates', href: '/admin/templates', icon: FileText },
    { name: 'Members', href: '/admin/members', icon: Users },
    { name: 'Faculties', href: '/admin/faculties', icon: Building2 },
    { name: 'Departments', href: '/admin/departments', icon: Briefcase },
    { name: 'Offices', href: '/admin/offices', icon: Building2 },
    { name: 'Users', href: '/admin/users', icon: Users },
  ];

  const profileLinks = [
    { name: 'Profile', href: '/profile', icon: Settings },
    { name: 'Sessions', href: '/profile/sessions', icon: Shield },
  ];

  const links = type === 'admin' ? adminLinks : profileLinks;

  return (
    <aside className="w-64 bg-sidebar border-r border-sidebar-border min-h-[calc(100vh-4rem)] flex-shrink-0">
      <div className="p-4 space-y-2">
        {links.map((link) => {
          const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
          const Icon = link.icon;
          
          return (
            <Link
              key={link.name}
              href={link.href}
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
  );
}
