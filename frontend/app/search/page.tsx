"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR, { SWRConfig } from "swr";
import Link from "next/link";
import { Search as SearchIcon, Calendar, FileText, Sparkles, Tag as TagIcon } from "lucide-react";
import Header from "../../components/Header";
import TagMultiSelect from "../../components/TagMultiSelect";
import { fetcher } from "../../lib/api";
import { sanitizeHtml } from "../../lib/sanitize";
import { localStorageProvider } from "../../lib/swrLocalStorageProvider";

const MATCH_TYPE_STYLES: Record<string, string> = {
  keyword: "bg-primary/10 text-primary",
  entity: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  semantic: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  tag: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
};

const MATCH_TYPE_LABELS: Record<string, string> = {
  keyword: "Keyword match",
  entity: "Related entity",
  semantic: "Semantic match",
  tag: "Tag match",
};

function formatMeetingTitle(result: any) {
  if (result.meeting_title) return result.meeting_title;
  const typeLabel = result.type === "academic" ? "Academic" : "Syndicate";
  return `${result.title} ${typeLabel} Meeting`;
}

function ResultCard({ result }: { result: any }) {
  return (
    <Link
      href={`/meetings/${result.meeting_id}?highlight=${result.agenda_id}&type=${result.matched_in}`}
      className="block bg-card border border-border rounded-lg p-5 hover:shadow-md hover:border-primary/40 transition-all"
    >
      <div className="flex items-start justify-between gap-4 mb-2">
        <h3 className="font-semibold text-foreground">{formatMeetingTitle(result)}</h3>
        <span className={`shrink-0 text-xs font-medium px-2 py-1 rounded-full ${MATCH_TYPE_STYLES[result.match_type] || "bg-muted text-muted-foreground"}`}>
          {MATCH_TYPE_LABELS[result.match_type] || result.match_type}
        </span>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
        <span className="flex items-center gap-1">
          <Calendar className="w-3.5 h-3.5" />
          {result.meeting_date ? new Date(result.meeting_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Date not set'}
        </span>
        <span className="bg-muted px-2 py-0.5 rounded-full capitalize">
          {result.matched_in === 'resolution' ? 'Resolution' : 'Agenda'}
        </span>
      </div>
      <div
        className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground [&_mark]:bg-primary/20 [&_mark]:text-foreground [&_mark]:rounded-sm [&_mark]:px-0.5"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(result.snippet) }}
      />
    </Link>
  );
}

function SearchPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [scope, setScope] = useState<"agenda" | "both">(searchParams.get("scope") === "agenda" ? "agenda" : "both");
  const [tagIds, setTagIds] = useState<string[]>((searchParams.get("tags") || "").split(",").filter(Boolean));
  const [dateFrom, setDateFrom] = useState(searchParams.get("dateFrom") || "");
  const [dateTo, setDateTo] = useState(searchParams.get("dateTo") || "");

  const { data: tagsResponse } = useSWR('/tags', fetcher, { fallbackData: { data: [] } });
  const allTags = tagsResponse?.data || [];

  const activeQuery = searchParams.get("q") || "";
  const hasSearchCriteria = !!activeQuery.trim() || tagIds.length > 0;

  useEffect(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (scope !== "both") params.set("scope", scope);
    if (tagIds.length > 0) params.set("tags", tagIds.join(","));
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    router.replace(`/search?${params.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, scope, tagIds, dateFrom, dateTo]);

  const searchKey = useMemo(() => {
    if (!activeQuery.trim() && tagIds.length === 0) return null;
    const params = new URLSearchParams();
    if (activeQuery.trim()) params.set("q", activeQuery.trim());
    params.set("scope", scope);
    if (tagIds.length > 0) params.set("tags", tagIds.join(","));
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    return `/search?${params.toString()}`;
  }, [activeQuery, scope, tagIds, dateFrom, dateTo]);

  const { data, isLoading } = useSWR(searchKey, fetcher);
  const results = data?.data || [];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-8">
        <form
          onSubmit={(e) => e.preventDefault()}
          className="relative mb-6"
        >
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search agendas & resolutions (English or Bangla)..."
            className="w-full pl-10 pr-4 py-3 text-base bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring text-foreground"
          />
        </form>

        <div className="bg-card border border-border rounded-lg p-4 mb-6 flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[180px]">
            <label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <TagIcon className="w-3.5 h-3.5" /> Tags
            </label>
            <TagMultiSelect options={allTags} value={tagIds} onChange={setTagIds} placeholder="Any tag" />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="px-3 py-2 text-sm bg-input/20 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-foreground"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="px-3 py-2 text-sm bg-input/20 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-foreground"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Search in</label>
            <div className="flex rounded-md border border-input overflow-hidden text-sm">
              <button
                type="button"
                onClick={() => setScope("agenda")}
                className={`px-3 py-2 flex items-center gap-1.5 transition-colors ${scope === "agenda" ? "bg-primary/10 text-primary font-medium" : "bg-input/20 text-muted-foreground hover:bg-accent"}`}
              >
                <FileText className="w-3.5 h-3.5" /> Agenda only
              </button>
              <button
                type="button"
                onClick={() => setScope("both")}
                className={`px-3 py-2 flex items-center gap-1.5 transition-colors border-l border-input ${scope === "both" ? "bg-primary/10 text-primary font-medium" : "bg-input/20 text-muted-foreground hover:bg-accent"}`}
              >
                <Sparkles className="w-3.5 h-3.5" /> Agenda + Resolution
              </button>
            </div>
          </div>
        </div>

        {!hasSearchCriteria ? (
          <div className="text-center text-muted-foreground py-16">
            Type a search term or select one or more tags above to find agendas, resolutions, departments, offices, or members.
          </div>
        ) : isLoading && !data ? (
          <div className="text-center text-muted-foreground py-16">Searching...</div>
        ) : results.length === 0 ? (
          <div className="text-center text-muted-foreground py-16">
            No results found.
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {results.length} result{results.length === 1 ? '' : 's'} found {activeQuery && <>for &quot;{activeQuery}&quot;</>}
            </p>
            {results.map((result: any) => (
              <ResultCard key={`${result.agenda_id}-${result.matched_in}`} result={result} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export default function SearchPage() {
  return (
    <SWRConfig value={{ provider: localStorageProvider }}>
      <Suspense fallback={
        <div className="min-h-screen flex flex-col bg-background">
          <Header />
          <div className="flex-1 text-center text-muted-foreground py-16">Loading search...</div>
        </div>
      }>
        <SearchPageInner />
      </Suspense>
    </SWRConfig>
  );
}
