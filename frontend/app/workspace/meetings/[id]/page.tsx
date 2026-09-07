"use client";

import { useSearchParams, useParams } from "next/navigation";
import useSWR from "swr";
import { fetcher } from "../../../../lib/api";

// View Components (to be created)
import MeetingInfoView from "../../../../components/meetings/MeetingInfoView";
import MeetingPermissionsView from "../../../../components/meetings/MeetingPermissionsView";
import InviteesView from "../../../../components/meetings/InviteesView";
import AgendaView from "../../../../components/meetings/AgendaView";
import ResolutionView from "../../../../components/meetings/ResolutionView";
import DescriptionView from "../../../../components/meetings/DescriptionView";
import MaterialsView from "../../../../components/meetings/MaterialsView";
import HistoryView from "../../../../components/meetings/HistoryView";
import EmailTabView from "../../../../components/meetings/EmailTabView";
import SignedPersonaView from "../../../../components/meetings/SignedPersonaView";
import ArchivedAgendaView from "../../../../components/meetings/ArchivedAgendaView";

import { useAuth } from "../../../../hooks/useAuth";

export default function MeetingWorkspace() {
  const params = useParams();
  const searchParams = useSearchParams();
  const view = searchParams.get('view') || 'info';
  const { user } = useAuth();

  // Fetch the meeting details
  const { data: response, error, mutate } = useSWR(`/meetings/${params.id}`, fetcher);

  if (error) return <div className="p-8 text-destructive font-medium">Error loading meeting data.</div>;
  if (!response) return <div className="p-8 text-muted-foreground">Loading workspace...</div>;

  const meeting = response.data;
  const isViewer = user?.role === 'viewer';
  const isPast = meeting?.status === 'past' || meeting?.is_completed === true;

  if (isViewer) {
    const effectiveView = searchParams.get('view') || (isPast ? 'resolution' : 'agenda');
    if (effectiveView === 'resolution' && isPast) {
      return <ResolutionView meeting={meeting} />;
    }
    if (effectiveView === 'suppli-agenda' && meeting?.is_suppli_visible_to_viewers) {
      return <AgendaView meeting={meeting} type="suppli-agenda" />;
    }
    return <AgendaView meeting={meeting} type="agenda" />;
  }

  // Render the appropriate view
  switch (view) {
    case 'info':
      return <MeetingInfoView meeting={meeting} mutate={mutate} />;
    case 'permissions':
      return <MeetingPermissionsView meeting={meeting} mutate={mutate} />;
    case 'description':
    case 'conclusion':
      return <DescriptionView meeting={meeting} type={view} mutate={mutate} />;
    case 'invitees':
      return <InviteesView meeting={meeting} type={view} mutate={mutate} />;
    case 'agenda':
    case 'suppli-agenda':
      return <AgendaView key={view} meeting={meeting} type={view} />;
    case 'archived-agenda':
      return <ArchivedAgendaView meeting={meeting} />;
    case 'resolution':
      return <ResolutionView meeting={meeting} />;
    case 'materials':
      return <MaterialsView meeting={meeting} />;
    case 'email':
      return <EmailTabView meeting={meeting} mutate={mutate} />;
    case 'signed-persona':
      return <SignedPersonaView meeting={meeting} mutate={mutate} />;
    case 'history':
      return <HistoryView meeting={meeting} />;
    default:
      return (
        <div className="p-8 text-muted-foreground">
          View "{view}" is under construction.
        </div>
      );
  }
}
