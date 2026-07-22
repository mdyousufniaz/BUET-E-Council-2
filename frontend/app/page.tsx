"use client";

import { useEffect, useState } from "react";
import Header from "../components/Header";
import MeetingTable from "../components/MeetingTable";
import useSWR from "swr";
import { fetcher } from "../lib/api";
import { useAuth } from "../hooks/useAuth";

export default function HomePage() {
  const { user } = useAuth();
  // A viewer scoped to a single member_type (academic/syndicate) only ever
  // sees that type; 'none' (or no logged-in user at all) sees both, same as today.
  const restrictedType = (user?.role === 'viewer' && ['academic', 'syndicate'].includes(user?.member_type))
    ? (user.member_type as 'academic' | 'syndicate')
    : null;

  const [activeTab, setActiveTab] = useState<'academic' | 'syndicate'>('academic');

  // Snap a restricted viewer onto their only allowed tab.
  useEffect(() => {
    if (restrictedType) setActiveTab(restrictedType);
  }, [restrictedType]);

  // Fetch real data
  const { data: response, error } = useSWR('/meetings', fetcher);

  const allMeetings = response?.data || [];
  
  // Filter by type, hiding drafts from the public dashboard
  const meetings = allMeetings
    .filter((m: any) => m.type === activeTab && m.status !== 'draft')
    .sort((a: any, b: any) => new Date(b.meeting_date).getTime() - new Date(a.meeting_date).getTime())
    .map((m: any, idx: number) => ({
      id: m.id,
      serial: m.title || idx + 1, // 'title' in DB holds the serial like "253"
      title: m.meeting_title || `${m.title} ${m.type} Meeting`,
      date: new Date(m.meeting_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    }));

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-8">
        
        {/* Tabs — a viewer scoped to one member_type only gets that one tab */}
        <div className="flex space-x-1 mb-8 border-b border-border">
          {(!restrictedType || restrictedType === 'academic') && (
            <button
              onClick={() => setActiveTab('academic')}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'academic'
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              }`}
            >
              Academic Meeting
            </button>
          )}
          {(!restrictedType || restrictedType === 'syndicate') && (
            <button
              onClick={() => setActiveTab('syndicate')}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'syndicate'
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              }`}
            >
              Syndicate Meeting
            </button>
          )}
        </div>

        {/* Meeting Table */}
        <MeetingTable meetings={meetings} />

      </main>
    </div>
  );
}
