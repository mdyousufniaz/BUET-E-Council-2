"use client";

import { useState } from "react";
import useSWR from "swr";
import api, { fetcher } from "../../../lib/api";
import { Laptop, Smartphone, Globe } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "../../../hooks/useConfirm";

export default function SessionsPage() {
  const { data: response, error, mutate } = useSWR('/auth/sessions', fetcher);
  const { confirm, ConfirmModal } = useConfirm();
  const handleRevoke = (id: string) => {
    confirm("Revoke Session", "Are you sure you want to revoke this session? The device will be logged out.", async () => {
      try {
        await api.delete(`/auth/sessions/${id}`);
        mutate();
        toast.success("Session revoked successfully");
      } catch (err: any) {
        toast.error(err.response?.data?.message || "Failed to revoke session");
      }
    });
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "desktop": return <Laptop className="w-5 h-5 text-muted-foreground" />;
      case "mobile": return <Smartphone className="w-5 h-5 text-muted-foreground" />;
      default: return <Globe className="w-5 h-5 text-muted-foreground" />;
    }
  };

  if (error) return <div className="p-8">Failed to load sessions</div>;
  if (!response) return <div className="p-8">Loading...</div>;

  const sessions = response.data?.sessions || [];

  return (
    <div className="space-y-6">
      <ConfirmModal />
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-foreground tracking-tight">Active Sessions</h2>
          <p className="text-sm text-muted-foreground mt-1">Manage and revoke your active API sessions across devices.</p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-muted text-muted-foreground text-sm border-b border-border">
                <th className="px-6 py-3 font-semibold">Device / Browser</th>
                <th className="px-6 py-3 font-semibold">IP Address</th>
                <th className="px-6 py-3 font-semibold">Last Active</th>
                <th className="px-6 py-3 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sessions.map((session: any) => (
                <tr key={session.id} className="hover:bg-accent/30 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-3">
                      <div className="p-2 bg-muted rounded-md">
                        {getIcon(session.type)}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {(() => {
                            try {
                              const info = JSON.parse(session.device_info);
                              return `${info.browser?.name || 'Unknown Browser'} on ${info.os?.name || 'Unknown OS'}`;
                            } catch (e) {
                              return 'Unknown Device';
                            }
                          })()} 
                          {session.is_current && <span className="ml-2 text-xs font-normal text-primary italic">(Current)</span>}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-foreground font-mono">
                    {session.ip_address}
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">
                    {new Date(session.created_at).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {!session.is_current ? (
                      <button 
                        onClick={() => handleRevoke(session.id)}
                        className="px-3 py-1 text-xs font-medium border border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground rounded-md transition-colors"
                      >
                        Revoke
                      </button>
                    ) : (
                      <span className="text-xs font-medium text-muted-foreground italic px-3 py-1">Active</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
