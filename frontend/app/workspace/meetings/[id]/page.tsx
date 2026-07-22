"use client";

import { useSearchParams, useParams } from "next/navigation";
import useSWR from "swr";
import { fetcher } from "../../../../lib/api";

// View Components (to be created)
import MeetingInfoView from "../../../../components/meetings/MeetingInfoView";
import InviteesView from "../../../../components/meetings/InviteesView";
import AgendaView from "../../../../components/meetings/AgendaView";
import ResolutionView from "../../../../components/meetings/ResolutionView";
import DescriptionView from "../../../../components/meetings/DescriptionView";
import MaterialsView from "../../../../components/meetings/MaterialsView";
import HistoryView from "../../../../components/meetings/HistoryView";

export default function MeetingWorkspace() {
  const params = useParams();
  const searchParams = useSearchParams();
  const view = searchParams.get('view') || 'info';

  // Fetch the meeting details
  const { data: response, error, mutate } = useSWR(`/meetings/${params.id}`, fetcher);

  if (error) return <div className="p-8 text-destructive font-medium">Error loading meeting data.</div>;
  if (!response) return <div className="p-8 text-muted-foreground">Loading workspace...</div>;

  const meeting = response.data;

  // Render the appropriate view
  switch (view) {
    case 'info':
      return <MeetingInfoView meeting={meeting} mutate={mutate} />;
    case 'description':
    case 'conclusion':
      return <DescriptionView meeting={meeting} type={view} mutate={mutate} />;
    case 'invitees':
      return <InviteesView meeting={meeting} type={view} mutate={mutate} />;
    case 'agenda':
    case 'suppli-agenda':
      return <AgendaView meeting={meeting} type={view} />;
    case 'resolution':
      return <ResolutionView meeting={meeting} />;
    case 'materials':
      return <MaterialsView meeting={meeting} />;
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
