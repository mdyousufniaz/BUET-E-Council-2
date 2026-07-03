import Link from 'next/link';
import UserDropdown from './UserDropdown';
import ThemeToggle from './ThemeToggle';

export default function Header() {
  return (
    <header className="sticky top-0 z-40 w-full backdrop-blur supports-[backdrop-filter]:bg-background/80 bg-card/90 border-b-2 border-primary/20" style={{ borderTop: '3px solid #800000' }}>
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center space-x-2">
          <span className="font-bold tracking-wide text-primary text-xl">
            BUET E-COUNCIL
          </span>
        </Link>
        <div className="flex items-center space-x-4">
          <ThemeToggle />
          <UserDropdown />
        </div>
      </div>
    </header>
  );
}
