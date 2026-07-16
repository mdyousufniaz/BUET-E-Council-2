"use client";

import { useEffect, useState } from "react";
import { Menu } from "lucide-react";

// Persistent hamburger toggle for a collapsed-by-default sidebar. Uses
// position: fixed (anchored to the viewport, not any particular scrolling
// element) so it never scrolls away regardless of which box actually
// scrolls, and always sits above the z-50 sidebar so it stays clickable -
// sliding to sit just past the sidebar's edge instead of underneath it.
// Dims on scroll and restores on hover, same as the top Header.
export default function SidebarToggleButton({ onClick, isOpen }: { onClick: () => void, isOpen: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const dimmed = scrolled && !hovered;

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ left: isOpen ? '17rem' : '1rem' }}
      className={`fixed top-20 z-[60] p-2 bg-card border border-border rounded-md text-foreground hover:bg-accent shadow-md transition-[left,opacity] duration-200 ${dimmed ? 'opacity-20' : 'opacity-100'}`}
      aria-label="Toggle menu"
    >
      <Menu className="w-6 h-6" />
    </button>
  );
}
