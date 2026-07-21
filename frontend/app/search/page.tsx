"use client";

import React, { useState, useEffect, useMemo, Suspense } from "react";
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
  "hybrid (all)": "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  "hybrid (keyword + entity)": "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  "hybrid (semantic + entity)": "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  "hybrid (keyword + semantic)": "bg-violet-500/10 text-violet-600 dark:text-violet-400",
};

const MATCH_TYPE_LABELS: Record<string, string> = {
  keyword: "Keyword match",
  entity: "Related entity",
  semantic: "Semantic match",
  tag: "Tag match",
  "hybrid (all)": "Strong match",
  "hybrid (keyword + entity)": "Keyword + entity",
  "hybrid (semantic + entity)": "Semantic + entity",
  "hybrid (keyword + semantic)": "Keyword + semantic",
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
  const [tagIdsInput, setTagIdsInput] = useState<string[]>((searchParams.get("tags") || "").split(",").filter(Boolean));
  const [dateFromInput, setDateFromInput] = useState(searchParams.get("dateFrom") || "");
  const [dateToInput, setDateToInput] = useState(searchParams.get("dateTo") || "");
  const [serialFromInput, setSerialFromInput] = useState(searchParams.get("serialFrom") || "");
  const [serialToInput, setSerialToInput] = useState(searchParams.get("serialTo") || "");

  const { data: tagsResponse } = useSWR('/tags', fetcher, { fallbackData: { data: [] } });
  const allTags = tagsResponse?.data || [];

  const activeQuery = searchParams.get("q") || "";
  const activeTagIds = useMemo(() => (searchParams.get("tags") || "").split(",").filter(Boolean), [searchParams]);
  const activeDateFrom = searchParams.get("dateFrom") || "";
  const activeDateTo = searchParams.get("dateTo") || "";
  const activeSerialFrom = searchParams.get("serialFrom") || "";
  const activeSerialTo = searchParams.get("serialTo") || "";
  const hasSearchCriteria = !!activeQuery.trim() || activeTagIds.length > 0 || !!activeSerialFrom || !!activeSerialTo;

  // Sync inputs with URL on searchParams change (e.g. back/forward navigation)
  useEffect(() => {
    setQuery(searchParams.get("q") || "");
    setScope(searchParams.get("scope") === "agenda" ? "agenda" : "both");
    setTagIdsInput((searchParams.get("tags") || "").split(",").filter(Boolean));
    setDateFromInput(searchParams.get("dateFrom") || "");
    setDateToInput(searchParams.get("dateTo") || "");
    setSerialFromInput(searchParams.get("serialFrom") || "");
    setSerialToInput(searchParams.get("serialTo") || "");
  }, [searchParams]);

  // Scope toggles apply immediately. Other inputs wait for form submit (Enter).
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (scope !== "both") params.set("scope", scope);
    else params.delete("scope");
    router.replace(`/search?${params.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const searchKey = useMemo(() => {
    if (!activeQuery.trim() && activeTagIds.length === 0 && !activeSerialFrom && !activeSerialTo) return null;
    const params = new URLSearchParams();
    if (activeQuery.trim()) params.set("q", activeQuery.trim());
    params.set("scope", scope);
    if (activeTagIds.length > 0) params.set("tags", activeTagIds.join(","));
    if (activeDateFrom) params.set("dateFrom", activeDateFrom);
    if (activeDateTo) params.set("dateTo", activeDateTo);
    if (activeSerialFrom) params.set("serialFrom", activeSerialFrom);
    if (activeSerialTo) params.set("serialTo", activeSerialTo);
    return `/search?${params.toString()}`;
  }, [activeQuery, scope, activeTagIds, activeDateFrom, activeDateTo, activeSerialFrom, activeSerialTo]);

  const { data, isLoading } = useSWR(searchKey, fetcher);
  const results = data?.data || [];

  const triggerSearch = () => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (scope !== "both") params.set("scope", scope);
    if (tagIdsInput.length > 0) params.set("tags", tagIdsInput.join(","));
    if (dateFromInput) params.set("dateFrom", dateFromInput);
    if (dateToInput) params.set("dateTo", dateToInput);
    if (serialFromInput.trim()) params.set("serialFrom", serialFromInput.trim());
    if (serialToInput.trim()) params.set("serialTo", serialToInput.trim());
    router.replace(`/search?${params.toString()}`, { scroll: false });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      triggerSearch();
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header hideSearch />
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-8">
        <form
          onSubmit={(e: React.FormEvent) => {
            e.preventDefault();
            triggerSearch();
          }}
        >
          <div className="relative mb-6">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search agendas & resolutions (English or Bangla)..."
              className="w-full pl-10 pr-4 py-3 text-base bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring text-foreground"
            />
          </div>

          <div className="bg-card border border-border rounded-lg p-4 mb-6 flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[180px]">
              <label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                <TagIcon className="w-3.5 h-3.5" /> Tags
              </label>
              <TagMultiSelect
                options={allTags}
                value={tagIdsInput}
                onChange={setTagIdsInput}
                placeholder="Any tag"
                onKeyDown={handleKeyDown}
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">From</label>
              <input
                type="date"
                value={dateFromInput}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDateFromInput(e.target.value)}
                onKeyDown={handleKeyDown}
                className="px-3 py-2 text-sm bg-input/20 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-foreground"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">To</label>
              <input
                type="date"
                value={dateToInput}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDateToInput(e.target.value)}
                onKeyDown={handleKeyDown}
                className="px-3 py-2 text-sm bg-input/20 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-foreground"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Serial From</label>
              <input
                type="number"
                min="0"
                value={serialFromInput}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSerialFromInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="e.g. 50"
                className="w-24 px-3 py-2 text-sm bg-input/20 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Serial To</label>
              <input
                type="number"
                min="0"
                value={serialToInput}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSerialToInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="e.g. 100"
                className="w-24 px-3 py-2 text-sm bg-input/20 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-foreground placeholder:text-muted-foreground"
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
        </form>

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
          <Header hideSearch />
          <div className="flex-1 text-center text-muted-foreground py-16">Loading search...</div>
        </div>
      }>
        <SearchPageInner />
      </Suspense>
    </SWRConfig>
  );
}
