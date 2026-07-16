"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import UserDropdown from './UserDropdown';
import ThemeToggle from './ThemeToggle';
import SearchBar from './SearchBar';

// The search box is for meetings/agendas content - it doesn't apply on these
// admin data-management pages or the profile/audit-log pages, so it's
// hidden there.
const SEARCH_HIDDEN_PREFIXES = [
  '/admin/members', '/admin/faculties', '/admin/users', '/admin/departments', '/admin/offices',
  '/admin/audit-log', '/profile',
];

export default function Header() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [hovered, setHovered] = useState(false);
  const showSearch = !SEARCH_HIDDEN_PREFIXES.some(prefix => pathname?.startsWith(prefix));

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Dim the header once the page is scrolled, so it's less visually intrusive
  // over content; hovering it always restores full opacity for interaction.
  const dimmed = scrolled && !hovered;

  return (
    <header
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`sticky top-0 z-40 w-full backdrop-blur supports-[backdrop-filter]:bg-background/80 bg-card/90 border-b-2 border-primary/20 transition-opacity duration-300 ${dimmed ? 'opacity-20' : 'opacity-100'}`}
      style={{ borderTop: '3px solid #800000' }}
    >
      <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center space-x-2 shrink-0">
          <span className="font-bold tracking-wide text-primary text-xl">
            BUET E-COUNCIL
          </span>
        </Link>
        <div className="flex items-center space-x-4 shrink-0">
          <ThemeToggle />
          <UserDropdown />
        </div>
      </div>
      {showSearch && (
        <div className="border-t border-border/50 px-4 py-2 flex justify-center">
          <SearchBar />
        </div>
      )}
    </header>
  );
}
