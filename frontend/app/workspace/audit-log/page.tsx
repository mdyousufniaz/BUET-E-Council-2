"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "../../../lib/api";
import { useAuth } from "../../../hooks/useAuth";

const ACTION_STYLES: Record<string, string> = {
  create: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  update: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  delete: "bg-destructive/10 text-destructive",
  login: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  login_failed: "bg-destructive/10 text-destructive",
  logout: "bg-muted text-muted-foreground",
  logout_all: "bg-muted text-muted-foreground",
};

export default function AuditLogPage() {
  const { isAdmin, isLoading } = useAuth();

  const [page, setPage] = useState(1);
  const [user, setUser] = useState("");
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const params = new URLSearchParams();
  params.set("page", String(page));
  if (user.trim()) params.set("user", user.trim());
  if (action) params.set("action", action);
  if (entityType) params.set("entity_type", entityType);
  if (dateFrom) params.set("from", dateFrom);
  if (dateTo) params.set("to", `${dateTo}T23:59:59.999`);

  const { data: response, isLoading: loadingLogs } = useSWR(
    isAdmin ? `/audit-logs?${params.toString()}` : null,
    fetcher
  );

  const { data: archivesResponse } = useSWR(isAdmin ? '/audit-logs/archives' : null, fetcher);
  const archives = archivesResponse?.data || [];

  if (isLoading) {
    return <div className="p-8 text-muted-foreground">Loading...</div>;
  }

  if (!isAdmin) {
    return (
      <div className="p-8">
        <h2 className="text-xl font-semibold mb-2">Forbidden</h2>
        <p className="text-muted-foreground text-sm">Only admins can view the audit log.</p>
      </div>
    );
  }

  const logs = response?.data || [];
  const pagination = response?.pagination;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <h2 className="text-2xl font-semibold text-foreground tracking-tight">Audit Log</h2>

      <div className="bg-card border border-border rounded-lg p-4 flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">User</label>
          <input
            type="text"
            value={user}
            onChange={(e) => { setUser(e.target.value); setPage(1); }}
            placeholder="Filter by username..."
            className="px-3 py-2 text-sm bg-input/20 border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Action</label>
          <select
            value={action}
            onChange={(e) => { setAction(e.target.value); setPage(1); }}
            className="px-3 py-2 text-sm bg-input/20 border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">Any</option>
            <option value="create">Create</option>
            <option value="update">Update</option>
            <option value="delete">Delete</option>
            <option value="login">Login</option>
            <option value="login_failed">Login failed</option>
            <option value="logout">Logout</option>
            <option value="logout_all">Logout all</option>
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Entity</label>
          <select
            value={entityType}
            onChange={(e) => { setEntityType(e.target.value); setPage(1); }}
            className="px-3 py-2 text-sm bg-input/20 border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">Any</option>
            <option value="meeting">Meeting</option>
            <option value="agenda">Agenda</option>
            <option value="user">User</option>
            <option value="auth">Auth</option>
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="px-3 py-2 text-sm bg-input/20 border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            className="px-3 py-2 text-sm bg-input/20 border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-muted text-muted-foreground text-sm border-b border-border">
                <th className="px-6 py-3 font-semibold">Time</th>
                <th className="px-6 py-3 font-semibold">User</th>
                <th className="px-6 py-3 font-semibold">Action</th>
                <th className="px-6 py-3 font-semibold">Entity</th>
                <th className="px-6 py-3 font-semibold">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loadingLogs && (
                <tr><td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">Loading...</td></tr>
              )}
              {!loadingLogs && logs.length === 0 && (
                <tr><td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">No matching audit log entries.</td></tr>
              )}
              {logs.map((log: any) => (
                <tr key={log.id} className="hover:bg-accent/50 transition-colors">
                  <td className="px-6 py-4 text-sm text-muted-foreground whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-foreground">
                    {log.username || "—"}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${ACTION_STYLES[log.action] || "bg-muted text-muted-foreground"}`}>
                      {log.action.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">
                    <span className="capitalize">{log.entity_type}</span>
                    {log.entity_id && <span className="text-xs opacity-60"> · {log.entity_id.slice(0, 8)}</span>}
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">{log.ip_address || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {pagination && (
          <div className="px-6 py-4 border-t border-border flex items-center justify-between text-sm text-muted-foreground">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="hover:text-foreground disabled:opacity-50"
            >
              Previous
            </button>
            <span>Page {pagination.page} of {pagination.totalPages || 1} ({pagination.total} total)</span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page >= pagination.totalPages}
              className="hover:text-foreground disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-foreground">Weekly Archives</h3>
        <p className="text-sm text-muted-foreground">
          A JSON export of each completed week's audit log is generated automatically and kept here.
        </p>
        <div className="bg-card border border-border rounded-lg divide-y divide-border">
          {archives.length === 0 && (
            <p className="px-4 py-4 text-sm text-muted-foreground">No weekly archives yet.</p>
          )}
          {archives.map((a: any) => (
            <a
              key={a.week}
              href={a.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between px-4 py-3 text-sm hover:bg-accent/50 transition-colors"
            >
              <span className="font-medium">{a.week}</span>
              <span className="text-muted-foreground">
                {(a.size / 1024).toFixed(1)} KB · {new Date(a.lastModified).toLocaleDateString()}
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
