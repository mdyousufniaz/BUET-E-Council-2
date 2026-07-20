"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { ChevronDown } from "lucide-react";
import { fetcher } from "../../../lib/api";
import { sanitizeHtml } from "../../../lib/sanitize";
import Header from "../../../components/Header";

// Component to render a single agenda and its annexures
function AgendaItem({ agenda, meetingStatus, highlightId, highlightType }: { agenda: any, meetingStatus: string, highlightId: string | null, highlightType: string | null }) {
  const { data: annexuresRes } = useSWR(`/agendas/${agenda.id}/annexures`, fetcher);
  const annexures = annexuresRes?.data || [];

  const isAgendaHighlight = highlightId === agenda.id && highlightType !== 'resolution';
  const isResolutionHighlight = highlightId === agenda.id && highlightType === 'resolution';
  const [showHighlight, setShowHighlight] = useState(isAgendaHighlight || isResolutionHighlight);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showHighlight || !ref.current) return;
    ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const timeout = setTimeout(() => setShowHighlight(false), 2500);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      id={`agenda-${agenda.id}`}
      ref={isAgendaHighlight ? ref : undefined}
      className={`border border-border rounded-lg p-6 bg-card transition-shadow ${isAgendaHighlight && showHighlight ? 'ring-2 ring-primary' : ''}`}
    >
      <h3 className="font-semibold text-lg mb-4 text-foreground">
        প্রস্তাব নং: {agenda.agenda_serial}
      </h3>
      <div
        className="prose prose-sm dark:prose-invert max-w-none mb-4 text-muted-foreground"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(agenda.content) }}
      />

      {meetingStatus === 'past' && agenda.resolution && (
        <div
          id={`resolution-${agenda.id}`}
          ref={isResolutionHighlight ? ref : undefined}
          className={`mt-4 pt-4 border-t border-border rounded-md transition-shadow ${isResolutionHighlight && showHighlight ? 'ring-2 ring-primary' : ''}`}
        >
          <h4 className="font-semibold mb-2 text-foreground">সিদ্ধান্ত:</h4>
          <div
            className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(agenda.resolution) }}
          />
        </div>
      )}

      {annexures.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border">
          <h4 className="font-semibold mb-2 text-foreground text-sm">সংযোজনী (Annexures):</h4>
          <ul className="space-y-2 mt-2">
            {annexures.map((annexure: any) => (
              <li key={annexure.id}>
                <a
                  href={annexure.url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline flex items-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6"></path><path d="M10 14L21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path></svg>
                  {annexure.file_name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function PublicMeetingView() {
  const params = useParams();
  const searchParams = useSearchParams();
  const highlightId = searchParams.get('highlight');
  const highlightType = searchParams.get('type');
  const [presenteesExpanded, setPresenteesExpanded] = useState(false);

  // Fetch the meeting details
  const { data: meetingRes, error: meetingError } = useSWR(`/meetings/${params.id}`, fetcher);

  // Fetch agendas
  const { data: agendasRes } = useSWR(meetingRes ? `/agendas?meeting_id=${params.id}` : null, fetcher);

  // Fetch presentees if meeting is past
  const { data: presenteesRes } = useSWR(meetingRes?.data?.status === 'past' ? `/meetings/${params.id}/presentees` : null, fetcher);

  if (meetingError) return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <div className="p-8 text-destructive font-medium mx-auto max-w-7xl">Error loading meeting data.</div>
    </div>
  );

  if (!meetingRes) return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <div className="p-8 text-muted-foreground mx-auto max-w-7xl">Loading meeting details...</div>
    </div>
  );

  const meeting = meetingRes.data;
  const agendas = agendasRes?.data || [];

  let rawPresentees = presenteesRes?.data || [];

  // Grouped Arrays
  let adminGroup: any[] = [];
  let deansGroup: any[] = [];
  let headsGroup: any[] = [];
  let departmentGroups: { [key: string]: any[] } = {};
  let othersGroup: any[] = [];

  if (rawPresentees.length > 0) {
    let filteredPresentees = rawPresentees;

    // 2. Process and Group
    filteredPresentees.forEach((p: any) => {
      // Handle members without a name
      if (!p.name || p.name.trim() === '') {
        const office = p.office_name || '';
        const parts = office.split(',');
        p.name = parts[0].trim() || 'Unknown';
        p.office_name = parts.slice(1).join(',').trim();
        othersGroup.push(p);
        return; // Early return, they go to 'others'
      }

      const des = (p.designation || '').toLowerCase();
      const office = (p.office_name || '').toLowerCase();

      // Determine categorization
      const isVC = (des.includes('উপাচার্য') || office.includes('উপাচার্য')) && !(des.includes('উপ-উপাচার্য') || office.includes('উপ-উপাচার্য'));
      const isProVC = des.includes('উপ-উপাচার্য') || office.includes('উপ-উপাচার্য');
      const isDean = office.includes('ডিন') || office.includes('dean') || des.includes('ডিন') || des.includes('dean');
      const isHead = office.includes('বিভাগীয় প্রধান') || office.includes('বিভাগীয় প্রধান');

      if (isVC) {
        p.department_name = 'সভাপতি';
        p.office_name = 'উপাচার্য, বাংলাদেশ প্রকৌশল বিশ্ববিদ্যালয়, ঢাকা';
        adminGroup.unshift(p);
      } else if (isProVC) {
        adminGroup.push(p);
      } else if (isDean) {
        deansGroup.push(p);
      } else if (isHead) {
        headsGroup.push(p);
      } else if (p.department_name) {
        if (!departmentGroups[p.department_name]) {
          departmentGroups[p.department_name] = [];
        }
        departmentGroups[p.department_name].push(p);
      } else {
        othersGroup.push(p);
      }
    });

    // Within each group, order members by their own presentee serial (seniority).
    const bySerial = (a: any, b: any) => (a.serial ?? Infinity) - (b.serial ?? Infinity);
    adminGroup.sort((a: any, b: any) => {
      const aIsVc = a.department_name === 'সভাপতি';
      const bIsVc = b.department_name === 'সভাপতি';
      if (aIsVc && !bIsVc) return -1;
      if (bIsVc && !aIsVc) return 1;
      return bySerial(a, b);
    });
    deansGroup.sort(bySerial);
    headsGroup.sort(bySerial);
    othersGroup.sort(bySerial);
    Object.values(departmentGroups).forEach(members => members.sort(bySerial));

    // Sort the Department groups based on the first member's department_serial
    const sortedDepartmentEntries = Object.entries(departmentGroups).sort((a, b) => {
      const serialA = a[1][0].department_serial || 999;
      const serialB = b[1][0].department_serial || 999;
      return serialA - serialB;
    });

    departmentGroups = Object.fromEntries(sortedDepartmentEntries);
  }

  const renderPresenteeCard = (p: any) => (
    <div key={p.id} className="p-4 bg-muted/50 rounded-lg border border-border">
      <div className="font-medium text-foreground">{p.name}</div>
      <div className="text-sm text-muted-foreground">{p.designation}</div>
      {(p.office_name || p.department_name) && (
        <div className="text-xs text-muted-foreground mt-1">
          {p.office_name ? p.office_name : p.department_name}
        </div>
      )}
      {p.department_name == "সভাপতি" && (
        <div className="text-xs text-muted-foreground mt-1">
          {p.department_name}
        </div>
      )}
    </div>
  );

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
            {meeting.description && (
              <section>
                <div
                  className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(meeting.description) }}
                />
              </section>
            )}

            {meeting.status === 'past' && (
              <>
                <section className="space-y-6">
                  <button
                    type="button"
                    onClick={() => setPresenteesExpanded(prev => !prev)}
                    className="w-full flex items-center justify-between text-xl font-semibold mb-4 text-primary border-b border-border pb-2"
                  >
                    <span>উপস্থিত সদস্যবৃন্দ ({rawPresentees.length})</span>
                    <ChevronDown className={`w-5 h-5 transition-transform ${presenteesExpanded ? 'rotate-180' : ''}`} />
                  </button>

                  {presenteesExpanded && rawPresentees.length === 0 && (
                    <p className="text-sm text-muted-foreground">এই সভার উপস্থিতির তথ্য সংরক্ষিত নেই।</p>
                  )}

                  {presenteesExpanded && adminGroup.length > 0 && (
                    <div>
                      <h3 className="text-lg font-medium mb-3 text-muted-foreground">প্রশাসন</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {adminGroup.map(renderPresenteeCard)}
                      </div>
                    </div>
                  )}

                  {presenteesExpanded && deansGroup.length > 0 && (
                    <div>
                      <h3 className="text-lg font-medium mb-3 text-muted-foreground">সকল ডিন</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {deansGroup.map(renderPresenteeCard)}
                      </div>
                    </div>
                  )}

                  {presenteesExpanded && headsGroup.length > 0 && (
                    <div>
                      <h3 className="text-lg font-medium mb-3 text-muted-foreground">সকল বিভাগীয় প্রধান</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {headsGroup.map(renderPresenteeCard)}
                      </div>
                    </div>
                  )}

                  {presenteesExpanded && Object.entries(departmentGroups).map(([deptName, members]) => (
                    <div key={deptName}>
                      <h3 className="text-lg font-medium mb-3 text-muted-foreground">{deptName}</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {members.map(renderPresenteeCard)}
                      </div>
                    </div>
                  ))}

                  {presenteesExpanded && othersGroup.length > 0 && (
                    <div>
                      <h3 className="text-lg font-medium mb-3 text-muted-foreground">অন্যান্য সদস্য</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {othersGroup.map(renderPresenteeCard)}
                      </div>
                    </div>
                  )}

                </section>
              </>
            )}

            {agendas.length > 0 && (
              <section>
                <div className="space-y-6">
                  {agendas.map((agenda: any) => (
                    <AgendaItem key={agenda.id} agenda={agenda} meetingStatus={meeting.status} highlightId={highlightId} highlightType={highlightType} />
                  ))}
                </div>
              </section>
            )}

            {meeting.conclusion && (
              <section>
                <div
                  className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(meeting.conclusion) }}
                />
              </section>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
