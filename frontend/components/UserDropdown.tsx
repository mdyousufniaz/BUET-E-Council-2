"use client";
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LayoutGrid, User, LogOut } from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../hooks/useAuth';

export default function UserDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { user, role, error } = useAuth();
  const dashboardHref = role === 'viewer' ? '/viewer/meetings' : '/admin';

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (error) {
      // If not authenticated, redirect to login page
      router.push('/login');
    }
  }, [error, router]);

  const handleSignOut = async () => {
    setIsOpen(false);
    try {
      await api.post('/auth/signout');
      router.push('/login');
    } catch (err) {
      console.error('Logout failed', err);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/20 hover:bg-primary/30 transition-colors border border-primary/30 focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <User className="w-5 h-5 text-primary" />
      </button>

      {isOpen && user && (
        <div className="absolute right-0 mt-2 w-48 bg-popover text-popover-foreground shadow-lg border border-border rounded-md py-1 z-50">
          <div className="px-4 py-2 border-b border-border/50">
            <p className="text-sm font-medium">{user.username}</p>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          </div>

          <Link href={dashboardHref} onClick={() => setIsOpen(false)} className="flex items-center px-4 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors">
            <LayoutGrid className="w-4 h-4 mr-2" />
            Dashboard
          </Link>

          <Link href="/profile" onClick={() => setIsOpen(false)} className="flex items-center px-4 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors">
            <User className="w-4 h-4 mr-2" />
            Profile
          </Link>

          <div className="border-t border-border/50 my-1"></div>

          <button
            onClick={handleSignOut}
            className="w-full flex items-center px-4 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
