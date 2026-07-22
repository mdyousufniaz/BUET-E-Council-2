"use client";

import { useState } from "react";
import { FileJson, X, Check, AlertCircle, Plus, Loader2, FileWarning } from "lucide-react";
import api, { fetcher } from "../../lib/api";
import useSWR from "swr";
import { toast } from "sonner";
import SearchableSelect from "../SearchableSelect";
import { resolveDepartmentByMergeRule } from "../../lib/departmentMergeRules";
import { resolveOfficeByMergeRule } from "../../lib/officeMergeRules";

interface ImportItem {
  key: string;
  fileName: string;
  parsedData: any | null;
  parseError: string | null;
  unresolvedDepts: string[];
  unresolvedOffices: string[];
  deptMapping: Record<string, string>;
  officeMapping: Record<string, string>;
  status: 'needs-resolution' | 'ready' | 'importing' | 'imported' | 'failed';
  errorMessage?: string;
}

const readFileAsText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsText(file);
  });

export default function JsonImportDialog({ onClose, onImportSuccess }: { onClose: () => void, onImportSuccess: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [isParsingFiles, setIsParsingFiles] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Modal state for creating a new department/office, shared across all files
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

  const { data: deptRes, mutate: mutateDepts } = useSWR('/departments', fetcher);
  const { data: officeRes, mutate: mutateOffices } = useSWR('/offices', fetcher);
  const { data: facultyRes } = useSWR('/faculties', fetcher);

  const departments = deptRes?.data || [];
  const offices = officeRes?.data || [];
  const faculties = facultyRes?.data || [];

  const buildImportItem = (fileName: string, key: string, rawText: string): ImportItem => {
    try {
      const data = JSON.parse(rawText);

      const depts = new Set<string>();
      const offs = new Set<string>();
      if (data.presentees && Array.isArray(data.presentees)) {
        data.presentees.forEach((p: any) => {
          if (p.department) depts.add(p.department.trim());
          if (p.office) offs.add(p.office.trim());
        });
      }

      const deptMapping: Record<string, string> = {};
      const officeMapping: Record<string, string> = {};
      const unresolvedDepts: string[] = [];
      const unresolvedOffices: string[] = [];

      Array.from(depts).forEach(d => {
        const found = departments.find((existing: any) => existing.name_english?.toLowerCase() === d.toLowerCase() || existing.name_bangla?.toLowerCase() === d.toLowerCase());
        if (found) {
          deptMapping[d] = found.id;
          return;
        }
        const mergeRuleMatch = resolveDepartmentByMergeRule(d, departments);
        if (mergeRuleMatch) deptMapping[d] = mergeRuleMatch;
        else unresolvedDepts.push(d);
      });

      Array.from(offs).forEach(o => {
        const found = offices.find((existing: any) => existing.name_english?.toLowerCase() === o.toLowerCase() || existing.name_bangla?.toLowerCase() === o.toLowerCase());
        if (found) {
          officeMapping[o] = found.id;
          return;
        }
        const mergeRuleMatch = resolveOfficeByMergeRule(o, offices);
        if (mergeRuleMatch) officeMapping[o] = mergeRuleMatch;
        else unresolvedOffices.push(o);
      });

      return {
        key, fileName, parsedData: data, parseError: null,
        unresolvedDepts, unresolvedOffices, deptMapping, officeMapping,
        status: (unresolvedDepts.length === 0 && unresolvedOffices.length === 0) ? 'ready' : 'needs-resolution'
      };
    } catch (e) {
      return {
        key, fileName, parsedData: null, parseError: 'Invalid file format',
        unresolvedDepts: [], unresolvedOffices: [], deptMapping: {}, officeMapping: {},
        status: 'failed', errorMessage: 'Invalid file format'
      };
    }
  };

  const handleFilesChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setIsParsingFiles(true);
    try {
      const newItems: ImportItem[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const key = `${file.name}-${i}-${Date.now()}`;
        try {
          const text = await readFileAsText(file);
          newItems.push(buildImportItem(file.name, key, text));
        } catch {
          newItems.push({
            key, fileName: file.name, parsedData: null, parseError: 'Failed to read file',
            unresolvedDepts: [], unresolvedOffices: [], deptMapping: {}, officeMapping: {},
            status: 'failed', errorMessage: 'Failed to read file'
          });
        }
      }
      setItems(newItems);
      setStep(2);
    } finally {
      setIsParsingFiles(false);
      e.target.value = "";
    }
  };

  const removeItem = (key: string) => {
    setItems(prev => prev.filter(i => i.key !== key));
  };

  // Applying a resolution (map-to-existing or create-new) for a given
  // original name propagates to every file in the batch that has the same
  // unresolved name, so the user only resolves each department/office once.
  const resolveDeptEverywhere = (name: string, deptId: string) => {
    setItems(prev => prev.map(item => {
      if (!item.unresolvedDepts.includes(name)) return item;
      const unresolvedDepts = item.unresolvedDepts.filter(d => d !== name);
      const deptMapping = { ...item.deptMapping, [name]: deptId };
      const status = (unresolvedDepts.length === 0 && item.unresolvedOffices.length === 0) ? 'ready' : 'needs-resolution';
      return { ...item, unresolvedDepts, deptMapping, status };
    }));
  };

  const resolveOfficeEverywhere = (name: string, officeId: string) => {
    setItems(prev => prev.map(item => {
      if (!item.unresolvedOffices.includes(name)) return item;
      const unresolvedOffices = item.unresolvedOffices.filter(o => o !== name);
      const officeMapping = { ...item.officeMapping, [name]: officeId };
      const status = (item.unresolvedDepts.length === 0 && unresolvedOffices.length === 0) ? 'ready' : 'needs-resolution';
      return { ...item, officeMapping, unresolvedOffices, status };
    }));
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
          resolveDeptEverywhere(editingEntity.originalName, newDept.id);
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
          resolveOfficeEverywhere(editingEntity.originalName, newOffice.id);
          mutateOffices();
          toast.success(`Created office: ${entityForm.name_english}`);
        }
      }
      setEditingEntity(null);
    } catch (e: any) {
      toast.error(e.response?.data?.message || `Failed to create ${editingEntity.type}`);
    }
  };

  const buildPayload = (item: ImportItem) => {
    const data = item.parsedData;
    return {
      meeting: {
        title: data.serial?.toString() || "",
        meeting_title: data.title || "",
        meeting_date: data.date || new Date().toISOString(),
        type: data.type || 'academic',
        status: data.status || 'past',
        description: data.description || "",
        conclusion: data.conclusion || "",
        president: data.president || ""
      },
      presentees: (data.presentees || []).map((p: any) => ({
        name: p.name,
        prefix: p.prefix,
        designation: p.designation,
        department_id: p.department ? item.deptMapping[p.department.trim()] : null,
        office_id: p.office ? item.officeMapping[p.office.trim()] : null
      })),
      agendas: (data.agenda || []).map((a: any) => ({
        agenda_serial: a.serial || 1,
        content: a.body || "",
        resolution: a.resolution || ""
      }))
    };
  };

  const handleFinalSubmit = async () => {
    const importable = items.filter(i => i.status === 'ready');
    if (importable.length === 0) {
      toast.error("No files are ready to import. Resolve missing departments/offices first.");
      return;
    }

    setIsProcessing(true);
    let succeeded = 0;
    let failed = 0;

    for (const item of importable) {
      setItems(prev => prev.map(i => i.key === item.key ? { ...i, status: 'importing' } : i));
      try {
        await api.post('/meetings/bulk-import', buildPayload(item));
        succeeded++;
        setItems(prev => prev.map(i => i.key === item.key ? { ...i, status: 'imported' } : i));
      } catch (e: any) {
        failed++;
        setItems(prev => prev.map(i => i.key === item.key ? { ...i, status: 'failed', errorMessage: e.response?.data?.message || 'Import failed' } : i));
      }
    }

    setIsProcessing(false);

    if (failed === 0) {
      toast.success(`${succeeded} meeting(s) imported successfully!`);
      onImportSuccess();
    } else {
      toast.error(`${succeeded} imported, ${failed} failed. See details below.`);
      onImportSuccess();
    }
  };

  const readyCount = items.filter(i => i.status === 'ready' || i.status === 'imported').length;
  const needsResolutionCount = items.filter(i => i.status === 'needs-resolution').length;
  const canFinalize = items.some(i => i.status === 'ready') && !isProcessing;

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border w-full max-w-3xl rounded-xl shadow-lg flex flex-col max-h-[90vh] relative">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 p-2 rounded-lg">
              <FileJson className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Import Meeting</h2>
              <p className="text-sm text-muted-foreground">
                {step === 1
                  ? 'Upload one or more files to import.'
                  : `${items.length} file(s) selected · ${readyCount} ready · ${needsResolutionCount} need attention`}
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
              <label
                htmlFor="json-import-files"
                className="flex-1 min-h-[300px] w-full bg-muted/30 border border-dashed border-border rounded-md p-4 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-primary/50 transition-colors"
              >
                {isParsingFiles ? (
                  <Loader2 className="w-10 h-10 text-muted-foreground animate-spin" />
                ) : (
                  <FileJson className="w-10 h-10 text-muted-foreground" />
                )}
                <p className="text-sm text-muted-foreground">
                  {isParsingFiles ? 'Reading files...' : 'Click to select one or more files'}
                </p>
                <input
                  id="json-import-files"
                  type="file"
                  accept="application/json,.json"
                  multiple
                  className="hidden"
                  onChange={handleFilesChange}
                  disabled={isParsingFiles}
                />
              </label>
            </div>
          ) : (
            <div className="space-y-4">
              {items.map(item => (
                <div key={item.key} className="border border-border rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between p-3 bg-muted/30">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileJson className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="text-sm font-medium truncate">{item.fileName}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge item={item} />
                      {item.status !== 'importing' && item.status !== 'imported' && (
                        <button onClick={() => removeItem(item.key)} className="p-1 text-muted-foreground hover:text-destructive transition-colors">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {item.parseError && (
                    <div className="p-3 text-sm text-destructive flex items-center gap-2">
                      <FileWarning className="w-4 h-4 shrink-0" /> {item.parseError}
                    </div>
                  )}

                  {item.status === 'failed' && item.errorMessage && !item.parseError && (
                    <div className="p-3 text-sm text-destructive flex items-center gap-2">
                      <FileWarning className="w-4 h-4 shrink-0" /> {item.errorMessage}
                    </div>
                  )}

                  {(item.unresolvedDepts.length > 0 || item.unresolvedOffices.length > 0) && (
                    <div className="p-4 space-y-3 border-t border-border">
                      {item.unresolvedDepts.map(dept => (
                        <div key={dept} className="flex items-center gap-3 bg-muted/20 p-2.5 rounded-md">
                          <div className="flex-1 text-sm font-medium truncate">{dept} <span className="text-xs text-muted-foreground">(dept)</span></div>
                          <div className="flex-1">
                            <SearchableSelect
                              options={departments.map((d: any) => ({ value: d.id, label: d.name_bangla }))}
                              value={item.deptMapping[dept] || ""}
                              onChange={(val) => resolveDeptEverywhere(dept, val)}
                              placeholder="Map to existing..."
                            />
                          </div>
                          <button
                            onClick={() => {
                              setEditingEntity({ type: 'department', originalName: dept });
                              setEntityForm({ name_english: dept, name_bangla: dept, alias_english: '', alias_bangla: '', faculty_id: faculties[0]?.id || '' });
                            }}
                            className="flex items-center gap-1 bg-primary text-primary-foreground px-2.5 py-1.5 rounded-md text-xs hover:bg-primary/90 transition-colors shrink-0"
                          >
                            <Plus className="w-3.5 h-3.5" /> Create
                          </button>
                        </div>
                      ))}
                      {item.unresolvedOffices.map(office => (
                        <div key={office} className="flex items-center gap-3 bg-muted/20 p-2.5 rounded-md">
                          <div className="flex-1 text-sm font-medium truncate">{office} <span className="text-xs text-muted-foreground">(office)</span></div>
                          <div className="flex-1">
                            <SearchableSelect
                              options={offices.map((o: any) => ({ value: o.id, label: o.name_bangla }))}
                              value={item.officeMapping[office] || ""}
                              onChange={(val) => resolveOfficeEverywhere(office, val)}
                              placeholder="Map to existing..."
                            />
                          </div>
                          <button
                            onClick={() => {
                              setEditingEntity({ type: 'office', originalName: office });
                              setEntityForm({ name_english: office, name_bangla: office, alias_english: '', alias_bangla: '', faculty_id: '' });
                            }}
                            className="flex items-center gap-1 bg-primary text-primary-foreground px-2.5 py-1.5 rounded-md text-xs hover:bg-primary/90 transition-colors shrink-0"
                          >
                            <Plus className="w-3.5 h-3.5" /> Create
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-border bg-muted/10 flex justify-end gap-3">
          <button
            onClick={step === 1 ? onClose : () => { setStep(1); setItems([]); }}
            disabled={isProcessing}
            className="px-4 py-2 border border-border text-foreground bg-card hover:bg-muted rounded-md transition-colors disabled:opacity-50"
          >
            {step === 1 ? 'Cancel' : 'Start Over'}
          </button>

          {step === 2 && (
            <button
              onClick={handleFinalSubmit}
              disabled={!canFinalize}
              className="px-6 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {isProcessing && <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />}
              {isProcessing ? 'Importing...' : `Import ${items.filter(i => i.status === 'ready').length} Ready File(s)`}
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

function StatusBadge({ item }: { item: ImportItem }) {
  const styles: Record<ImportItem['status'], string> = {
    'needs-resolution': 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
    'ready': 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    'importing': 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
    'imported': 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    'failed': 'bg-destructive/10 text-destructive',
  };
  const labels: Record<ImportItem['status'], string> = {
    'needs-resolution': 'Needs attention',
    'ready': 'Ready',
    'importing': 'Importing...',
    'imported': 'Imported',
    'failed': 'Failed',
  };
  const icon = item.status === 'imported' ? <Check className="w-3 h-3" /> :
    item.status === 'importing' ? <Loader2 className="w-3 h-3 animate-spin" /> :
    (item.status === 'failed' || item.status === 'needs-resolution') ? <AlertCircle className="w-3 h-3" /> : null;

  return (
    <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${styles[item.status]}`}>
      {icon} {labels[item.status]}
    </span>
  );
}
