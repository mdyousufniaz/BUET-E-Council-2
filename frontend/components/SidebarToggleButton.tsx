import { Menu } from "lucide-react";

// Mobile-only hamburger toggle for the off-canvas Sidebar drawer; hidden at
// md+ widths where the sidebar is always visible.
export default function SidebarToggleButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="md:hidden mb-4 p-2 -ml-2 text-foreground hover:bg-accent rounded-md"
      aria-label="Open menu"
    >
      <Menu className="w-6 h-6" />
    </button>
  );
}
