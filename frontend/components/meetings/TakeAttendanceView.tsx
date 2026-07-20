"use client";

import { useState, useMemo } from "react";
import { Check, X, Users, Building, ShieldCheck } from "lucide-react";

interface Invitee {
  id: string;
  name: string;
  designation: string;
  department_name: string;
  department_serial: number;
  office_name: string;
  is_present: boolean;
  serial: number;
}

interface TakeAttendanceViewProps {
  invitees: Invitee[];
  onSave: (presentIds: string[]) => void;
  onCancel: () => void;
  isSaving: boolean;
}

export default function TakeAttendanceView({ invitees, onSave, onCancel, isSaving }: TakeAttendanceViewProps) {
  // Initialize state with currently present invitees
  const [presentIds, setPresentIds] = useState<Set<string>>(() => {
    return new Set(invitees.filter(i => i.is_present).map(i => i.id));
  });

  // Grouping logic
  const { vcGroup, deptGroups, othersGroup } = useMemo(() => {
    const vc: Invitee[] = [];
    const depts: Record<string, { serial: number, members: Invitee[] }> = {};
    const others: Invitee[] = [];

    const isVC = (designation: string) => {
      if (!designation) return false;
      const lower = designation.toLowerCase();
      return ['উপাচার্য', 'উপ-উপাচার্য', 'vc', 'pro-vc', 'vice chancellor', 'pro vice chancellor'].includes(lower) || lower.includes('উপাচার্য') || lower.includes('vc');
    };

    invitees.forEach(invitee => {
      if (isVC(invitee.designation)) {
        vc.push(invitee);
      } else if (invitee.department_name) {
        if (!depts[invitee.department_name]) {
          depts[invitee.department_name] = {
            serial: invitee.department_serial || 9999,
            members: []
          };
        }
        depts[invitee.department_name].members.push(invitee);
      } else {
        others.push(invitee);
      }
    });

    // Sort each group's members by seniority (presentee/invitee serial)
    const bySerial = (a: Invitee, b: Invitee) => (a.serial ?? Infinity) - (b.serial ?? Infinity);
    vc.sort(bySerial);
    others.sort(bySerial);
    Object.values(depts).forEach(dept => dept.members.sort(bySerial));

    // Sort departments by serial
    const sortedDepts = Object.entries(depts)
      .sort(([, a], [, b]) => a.serial - b.serial)
      .map(([name, data]) => ({ name, members: data.members }));

    return { vcGroup: vc, deptGroups: sortedDepts, othersGroup: others };
  }, [invitees]);

  const toggleMember = (id: string) => {
    setPresentIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleGroup = (members: Invitee[], isAllSelected: boolean) => {
    setPresentIds(prev => {
      const next = new Set(prev);
      members.forEach(m => {
        if (isAllSelected) next.delete(m.id);
        else next.add(m.id);
      });
      return next;
    });
  };

  const renderGroup = (title: string, members: Invitee[], icon: React.ReactNode) => {
    if (members.length === 0) return null;
    
    const isAllSelected = members.length > 0 && members.every(m => presentIds.has(m.id));
    const isIndeterminate = members.some(m => presentIds.has(m.id)) && !isAllSelected;

    return (
      <div className="mb-6 bg-card border border-border rounded-lg overflow-hidden shadow-sm">
        <div className="bg-muted/50 px-4 py-3 flex items-center justify-between border-b border-border">
          <div className="flex items-center gap-2">
            {icon}
            <h3 className="font-semibold text-foreground">{title}</h3>
            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
              {members.length} members
            </span>
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input 
              type="checkbox"
              className="w-4 h-4 rounded border-input text-primary focus:ring-primary cursor-pointer"
              checked={isAllSelected}
              ref={input => { if (input) input.indeterminate = isIndeterminate; }}
              onChange={() => toggleGroup(members, isAllSelected)}
            />
            <span className="text-sm font-medium text-muted-foreground">Select All</span>
          </label>
        </div>
        <div className="divide-y divide-border">
          {members.map(member => (
            <label key={member.id} className="flex items-center px-4 py-3 hover:bg-muted/30 cursor-pointer transition-colors group">
              <input 
                type="checkbox"
                className="w-4 h-4 rounded border-input text-primary focus:ring-primary cursor-pointer mt-0.5"
                checked={presentIds.has(member.id)}
                onChange={() => toggleMember(member.id)}
              />
              <div className="ml-3 flex-1">
                <div className="font-medium text-foreground group-hover:text-primary transition-colors">
                  {member.name}
                </div>
                <div className="text-sm text-muted-foreground flex items-center gap-2 mt-0.5">
                  {member.designation && <span>{member.designation}</span>}
                  {member.office_name && (
                    <>
                      <span className="w-1 h-1 rounded-full bg-border" />
                      <span>{member.office_name}</span>
                    </>
                  )}
                </div>
              </div>
            </label>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
            Take Attendance
          </h2>
          <p className="text-muted-foreground text-sm mt-1">Select the members who are present in the meeting.</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={onCancel}
            disabled={isSaving}
            className="px-4 py-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground text-sm font-medium rounded-md transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={() => onSave(Array.from(presentIds))}
            disabled={isSaving}
            className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium rounded-md flex items-center gap-2 transition-colors shadow-sm disabled:opacity-50"
          >
            {isSaving ? "Saving..." : (
              <>
                <Check className="w-4 h-4" /> Save Attendance
              </>
            )}
          </button>
        </div>
      </div>

      <div className="bg-muted/30 p-4 rounded-lg border border-border mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-sm font-medium text-foreground">Total Present:</span>
          <span className="text-lg font-bold text-primary">{presentIds.size}</span>
          <span className="text-sm text-muted-foreground">/ {invitees.length}</span>
        </div>
      </div>

      <div className="space-y-6">
        {renderGroup("VC & Pro-VC", vcGroup, <ShieldCheck className="w-5 h-5 text-primary" />)}
        
        {deptGroups.map(dept => 
          renderGroup(dept.name, dept.members, <Building className="w-5 h-5 text-blue-500" />)
        )}

        {renderGroup("Others", othersGroup, <Users className="w-5 h-5 text-muted-foreground" />)}
        
        {invitees.length === 0 && (
          <div className="text-center py-16 bg-card border border-border rounded-lg shadow-sm">
            <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-medium text-foreground">No invitees found</h3>
            <p className="text-muted-foreground mt-1">Please add invitees to the meeting first.</p>
          </div>
        )}
      </div>
    </div>
  );
}
