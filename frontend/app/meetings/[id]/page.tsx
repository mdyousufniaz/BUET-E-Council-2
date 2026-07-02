"use client";

import { useParams } from "next/navigation";
import useSWR from "swr";
import { fetcher } from "../../../lib/api";
import Header from "../../../components/Header";

export default function PublicMeetingView() {
  const params = useParams();
  
  // Fetch the meeting details
  const { data: response, error } = useSWR(`/meetings/${params.id}`, fetcher);

  if (error) return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <div className="p-8 text-destructive font-medium mx-auto max-w-7xl">Error loading meeting data.</div>
    </div>
  );
  
  if (!response) return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <div className="p-8 text-muted-foreground mx-auto max-w-7xl">Loading meeting details...</div>
    </div>
  );

  const meeting = response.data;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-8">
        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="border-b border-border pb-6 mb-6">
            <h1 className="text-3xl font-bold mb-2">
              {meeting.meeting_title || `${meeting.title} ${meeting.type === 'academic' ? 'Academic' : 'Syndicate'} Meeting`}
            </h1>
            <div className="flex gap-4 text-sm text-muted-foreground">
              <span className="bg-muted px-2 py-1 rounded-md capitalize">{meeting.type} Meeting</span>
              <span className="bg-muted px-2 py-1 rounded-md capitalize">{meeting.status}</span>
              <span className="flex items-center">
                {meeting.meeting_date ? new Date(meeting.meeting_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Date not set'}
              </span>
            </div>
          </div>

          <div className="space-y-8">
            <section>
              <h2 className="text-xl font-semibold mb-4 text-primary">Overview</h2>
              {meeting.description ? (
                <div 
                  className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground"
                  dangerouslySetInnerHTML={{ __html: meeting.description }}
                />
              ) : (
                <p className="text-muted-foreground italic">No overview provided.</p>
              )}
            </section>
            
            {meeting.president && (
              <section>
                <h2 className="text-xl font-semibold mb-2 text-primary">President</h2>
                <p className="text-muted-foreground">{meeting.president}</p>
              </section>
            )}

            <section>
              <h2 className="text-xl font-semibold mb-4 text-primary">Conclusion</h2>
              {meeting.conclusion ? (
                <div 
                  className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground"
                  dangerouslySetInnerHTML={{ __html: meeting.conclusion }}
                />
              ) : (
                <p className="text-muted-foreground italic">No conclusion provided.</p>
              )}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
