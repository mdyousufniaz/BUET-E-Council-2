"use client";

import { useState } from "react";
import { FileJson, X, Check, AlertCircle, Plus } from "lucide-react";
import api, { fetcher } from "../../lib/api";
import useSWR from "swr";
import { toast } from "sonner";
import SearchableSelect from "../SearchableSelect";

export default function JsonImportDialog({ onClose, onImportSuccess }: { onClose: () => void, onImportSuccess: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [jsonText, setJsonText] = useState("");
  const [parsedData, setParsedData] = useState<any>(null);
  
  const [unresolvedDepts, setUnresolvedDepts] = useState<string[]>([]);
  const [unresolvedOffices, setUnresolvedOffices] = useState<string[]>([]);
  
  const [deptMapping, setDeptMapping] = useState<Record<string, string>>({});
  const [officeMapping, setOfficeMapping] = useState<Record<string, string>>({});
  
  const [isProcessing, setIsProcessing] = useState(false);

  // Modal state for creating new entity
  const [editingEntity, setEditingEntity] = useState<{
    type: 'department' | 'office';
    originalName: string;
  } | null>(null);

  const [entityForm, setEntityForm] = useState({
    name_english: '',
    name_bangla: '',
    alias_english: '',
    alias_bangla: '',
    faculty_id: ''
  });

  // Fetch data
  const { data: deptRes, mutate: mutateDepts } = useSWR('/departments', fetcher);
  const { data: officeRes, mutate: mutateOffices } = useSWR('/offices', fetcher);
  const { data: facultyRes } = useSWR('/faculties', fetcher);

  const departments = deptRes?.data || [];
  const offices = officeRes?.data || [];
  const faculties = facultyRes?.data || [];

  const handleParse = () => {
    try {
      const data = JSON.parse(jsonText);
      setParsedData(data);
      
      const depts = new Set<string>();
      const offs = new Set<string>();

      if (data.presentees && Array.isArray(data.presentees)) {
        data.presentees.forEach((p: any) => {
          if (p.department) depts.add(p.department.trim());
          if (p.office) offs.add(p.office.trim());
        });
      }

      // Check against existing
      const missingDepts: string[] = [];
      const missingOffices: string[] = [];
      
      const newDeptMapping = { ...deptMapping };
      const newOfficeMapping = { ...officeMapping };

      Array.from(depts).forEach(d => {
        const found = departments.find((existing: any) => existing.name_english?.toLowerCase() === d.toLowerCase() || existing.name_bangla?.toLowerCase() === d.toLowerCase());
        if (found) {
          newDeptMapping[d] = found.id;
        } else {
          missingDepts.push(d);
        }
      });

      Array.from(offs).forEach(o => {
        const found = offices.find((existing: any) => existing.name_english?.toLowerCase() === o.toLowerCase() || existing.name_bangla?.toLowerCase() === o.toLowerCase());
        if (found) {
          newOfficeMapping[o] = found.id;
        } else {
          missingOffices.push(o);
        }
      });

      setDeptMapping(newDeptMapping);
      setOfficeMapping(newOfficeMapping);
      setUnresolvedDepts(missingDepts);
      setUnresolvedOffices(missingOffices);
      
      setStep(2);
    } catch (e) {
      toast.error("Invalid JSON format");
    }
  };

  const submitEntityForm = async () => {
    if (!editingEntity) return;

    try {
      if (editingEntity.type === 'department') {
        if (!entityForm.faculty_id) {
          toast.error("Faculty is required");
          return;
        }
        const res = await api.post('/departments', entityForm);
        const newDept = res.data.department || res.data.data;
        if (newDept && newDept.id) {
          setDeptMapping(prev => ({ ...prev, [editingEntity.originalName]: newDept.id }));
          setUnresolvedDepts(prev => prev.filter(d => d !== editingEntity.originalName));
          mutateDepts();
          toast.success(`Created department: ${entityForm.name_english}`);
        }
      } else {
        const res = await api.post('/offices', {
          name_english: entityForm.name_english,
          name_bangla: entityForm.name_bangla
        });
        const newOffice = res.data.office || res.data.data;
        if (newOffice && newOffice.id) {
          setOfficeMapping(prev => ({ ...prev, [editingEntity.originalName]: newOffice.id }));
          setUnresolvedOffices(prev => prev.filter(o => o !== editingEntity.originalName));
          mutateOffices();
          toast.success(`Created office: ${entityForm.name_english}`);
        }
      }
      setEditingEntity(null);
    } catch (e: any) {
      toast.error(e.response?.data?.message || `Failed to create ${editingEntity.type}`);
    }
  };

  const handleFinalSubmit = async () => {
    // Check if any remain unresolved
    if (unresolvedDepts.length > 0 || unresolvedOffices.length > 0) {
      toast.error("Please resolve all missing departments and offices first.");
      return;
    }

    setIsProcessing(true);
    try {
      // Build final payload
      const payload = {
        meeting: {
          title: parsedData.serial?.toString() || "",
          meeting_title: parsedData.title || "",
          meeting_date: parsedData.date || new Date().toISOString(),
          type: parsedData.type || 'academic',
          status: parsedData.status || 'past',
          description: parsedData.description || "",
          conclusion: parsedData.conclusion || "",
          president: parsedData.president || ""
        },
        presentees: (parsedData.presentees || []).map((p: any) => ({
          name: p.name,
          prefix: p.prefix,
          designation: p.designation,
          department_id: p.department ? deptMapping[p.department.trim()] : null,
          office_id: p.office ? officeMapping[p.office.trim()] : null
        })),
        agendas: (parsedData.agenda || []).map((a: any) => ({
          agenda_serial: a.serial || 1,
          content: a.body || "",
          resolution: a.resolution || ""
        }))
      };

      await api.post('/meetings/bulk-import', payload);
      toast.success("Meeting imported successfully!");
      onImportSuccess();
    } catch (e: any) {
      toast.error(e.response?.data?.message || "Failed to import meeting");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border w-full max-w-3xl rounded-xl shadow-lg flex flex-col max-h-[90vh] relative">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 p-2 rounded-lg">
              <FileJson className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Import Meeting JSON</h2>
              <p className="text-sm text-muted-foreground">
                {step === 1 ? 'Paste your JSON payload below.' : 'Resolve missing dependencies.'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-full transition-colors">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        <div className="p-6 flex-1 overflow-y-auto">
          {step === 1 ? (
            <div className="space-y-4 h-full flex flex-col">
              <textarea
                className="flex-1 min-h-[300px] w-full bg-muted/30 border border-border rounded-md p-4 text-sm font-mono focus:outline-none focus:border-primary/50"
                placeholder={'{\n  "serial": "1",\n  "title": "Meeting Title",\n  ...\n}'}
                value={jsonText}
                onChange={e => setJsonText(e.target.value)}
              />
            </div>
          ) : (
            <div className="space-y-8">
              {(unresolvedDepts.length === 0 && unresolvedOffices.length === 0) ? (
                <div className="bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-400 p-4 rounded-lg flex items-start gap-3">
                  <Check className="w-5 h-5 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-medium">All Dependencies Resolved</h4>
                    <p className="text-sm opacity-90">Ready to import the meeting into the database.</p>
                  </div>
                </div>
              ) : (
                <div className="bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 dark:text-yellow-400 p-4 rounded-lg flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-medium">Action Required</h4>
                    <p className="text-sm opacity-90">Some departments or offices from your JSON don't match existing records. Please map them or create them.</p>
                  </div>
                </div>
              )}

              {unresolvedDepts.length > 0 && (
                <div>
                  <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                    <span className="bg-destructive/10 text-destructive px-2 py-0.5 rounded text-sm">{unresolvedDepts.length}</span>
                    Unresolved Departments
                  </h3>
                  <div className="space-y-4">
                    {unresolvedDepts.map(dept => (
                      <div key={dept} className="flex items-center gap-4 bg-muted/30 p-3 rounded-lg border border-border">
                        <div className="flex-1 font-medium">{dept}</div>
                        <div className="flex-1">
                          <SearchableSelect
                            options={departments.map((d: any) => ({ value: d.id, label: d.name_english || d.name_bangla }))}
                            value={deptMapping[dept] || ""}
                            onChange={(val) => {
                              setDeptMapping(prev => ({ ...prev, [dept]: val }));
                              setUnresolvedDepts(prev => prev.filter(d => d !== dept));
                            }}
                            placeholder="Map to existing..."
                          />
                        </div>
                        <div className="text-muted-foreground text-sm">or</div>
                        <button
                          onClick={() => {
                            setEditingEntity({ type: 'department', originalName: dept });
                            setEntityForm({
                              name_english: dept,
                              name_bangla: dept,
                              alias_english: '',
                              alias_bangla: '',
                              faculty_id: faculties[0]?.id || ''
                            });
                          }}
                          className="flex items-center gap-1 bg-primary text-primary-foreground px-3 py-2 rounded-md text-sm hover:bg-primary/90 transition-colors"
                        >
                          <Plus className="w-4 h-4" /> Create New
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {unresolvedOffices.length > 0 && (
                <div>
                  <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                    <span className="bg-destructive/10 text-destructive px-2 py-0.5 rounded text-sm">{unresolvedOffices.length}</span>
                    Unresolved Offices
                  </h3>
                  <div className="space-y-4">
                    {unresolvedOffices.map(office => (
                      <div key={office} className="flex items-center gap-4 bg-muted/30 p-3 rounded-lg border border-border">
                        <div className="flex-1 font-medium">{office}</div>
                        <div className="flex-1">
                          <SearchableSelect
                            options={offices.map((o: any) => ({ value: o.id, label: o.name_english || o.name_bangla }))}
                            value={officeMapping[office] || ""}
                            onChange={(val) => {
                              setOfficeMapping(prev => ({ ...prev, [office]: val }));
                              setUnresolvedOffices(prev => prev.filter(o => o !== office));
                            }}
                            placeholder="Map to existing..."
                          />
                        </div>
                        <div className="text-muted-foreground text-sm">or</div>
                        <button
                          onClick={() => {
                            setEditingEntity({ type: 'office', originalName: office });
                            setEntityForm({
                              name_english: office,
                              name_bangla: office,
                              alias_english: '',
                              alias_bangla: '',
                              faculty_id: ''
                            });
                          }}
                          className="flex items-center gap-1 bg-primary text-primary-foreground px-3 py-2 rounded-md text-sm hover:bg-primary/90 transition-colors"
                        >
                          <Plus className="w-4 h-4" /> Create New
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-border bg-muted/10 flex justify-end gap-3">
          <button
            onClick={step === 1 ? onClose : () => setStep(1)}
            className="px-4 py-2 border border-border text-foreground bg-card hover:bg-muted rounded-md transition-colors"
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </button>
          
          {step === 1 ? (
            <button
              onClick={handleParse}
              disabled={!jsonText.trim()}
              className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md transition-colors disabled:opacity-50"
            >
              Parse JSON
            </button>
          ) : (
            <button
              onClick={handleFinalSubmit}
              disabled={isProcessing || unresolvedDepts.length > 0 || unresolvedOffices.length > 0}
              className="px-6 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {isProcessing && <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />}
              {isProcessing ? 'Importing...' : 'Finalize & Import'}
            </button>
          )}
        </div>

        {editingEntity && (
          <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center p-4 rounded-xl">
            <div className="bg-card w-full max-w-md rounded-lg shadow-xl p-6 border border-border">
              <h3 className="text-lg font-bold mb-4 capitalize">Create New {editingEntity.type}</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Name (English) *</label>
                  <input
                    value={entityForm.name_english}
                    onChange={e => setEntityForm({ ...entityForm, name_english: e.target.value })}
                    className="w-full p-2 border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Name (Bangla) *</label>
                  <input
                    value={entityForm.name_bangla}
                    onChange={e => setEntityForm({ ...entityForm, name_bangla: e.target.value })}
                    className="w-full p-2 border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary text-sm"
                  />
                </div>
                
                {editingEntity.type === 'department' && (
                  <>
                    <div>
                      <label className="text-sm font-medium mb-1 block">Alias (English) *</label>
                      <input
                        value={entityForm.alias_english}
                        onChange={e => setEntityForm({ ...entityForm, alias_english: e.target.value })}
                        className="w-full p-2 border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block">Alias (Bangla) *</label>
                      <input
                        value={entityForm.alias_bangla}
                        onChange={e => setEntityForm({ ...entityForm, alias_bangla: e.target.value })}
                        className="w-full p-2 border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block">Faculty *</label>
                      <SearchableSelect
                        options={faculties.map((f: any) => ({ value: f.id, label: f.name_english || f.name_bangla }))}
                        value={entityForm.faculty_id}
                        onChange={(val) => setEntityForm({ ...entityForm, faculty_id: val })}
                      />
                    </div>
                  </>
                )}
                
                <div className="flex justify-end gap-2 pt-4">
                  <button
                    onClick={() => setEditingEntity(null)}
                    className="px-4 py-2 border border-border rounded-md hover:bg-muted text-sm transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitEntityForm}
                    disabled={!entityForm.name_english || !entityForm.name_bangla || (editingEntity.type === 'department' && (!entityForm.alias_english || !entityForm.alias_bangla || !entityForm.faculty_id))}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    Save & Map
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
