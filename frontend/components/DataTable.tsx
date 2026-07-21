"use client";

import { useState, useRef, useMemo } from 'react';
import { GripVertical, Pencil, Trash2, Eye, Upload, Download, ArrowUpDown, ArrowUp, ArrowDown, Search } from 'lucide-react';

interface Column {
  key: string;
  label: string;
  sortable?: boolean;
}

interface DataTableProps {
  columns: Column[];
  data: any[];
  title?: string;
  onReorder?: (newOrder: any[]) => void;
  // Alternative to onReorder for lists that aren't the complete/unfiltered
  // dataset (e.g. a meeting's invitees, a subset of all members) — recomputing
  // every row's serial from its local index would be wrong there. Called with
  // the moved row's original index and its drop target index instead, so the
  // caller can derive a serial from its actual new neighbors. Takes priority
  // over onReorder if both are passed.
  onReorderItem?: (sourceIndex: number, targetIndex: number) => void;
  onUploadCsv?: (file: File) => void;
  onDownloadCsv?: () => void;
  onAdd?: () => void;
  onEdit?: (row: any) => void;
  onDelete?: (row: any) => void;
  onView?: (row: any) => void;
  onFetchApi?: () => void;
  fetchApiLabel?: string;
  customActions?: React.ReactNode;
  searchable?: boolean;
  searchPlaceholder?: string;
  filters?: React.ReactNode;
  // Bulk-selection mode: renders a checkbox column (with a header
  // "select all") instead of the per-row action buttons.
  selectable?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleSelectAll?: (visibleIds: string[], selectAll: boolean) => void;
}

export default function DataTable({
  columns,
  data: initialData,
  title,
  onReorder,
  onReorderItem,
  onUploadCsv,
  onDownloadCsv,
  onAdd,
  onEdit,
  onDelete,
  onView,
  onFetchApi,
  fetchApiLabel,
  customActions,
  searchable,
  searchPlaceholder,
  filters,
  selectable,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll
}: DataTableProps) {
  const [data, setData] = useState(initialData);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [query, setQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reorderEnabled = !selectable && !!(onReorder || onReorderItem);

  // Update local state when initialData changes (from SWR)
  // We use a simple effect here just in case, though ideally SWR handles it better if we pass it down
  // For simplicity, we just sync them if initialData changes length or items.
  if (data.length !== initialData.length) {
      setData(initialData);
  }

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    } else if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') {
      // Third click removes sorting
      setSortConfig(null);
      return;
    }
    setSortConfig({ key, direction });
  };

  const sortedData = useMemo(() => {
    if (!sortConfig) return data;
    
    return [...data].sort((a, b) => {
      if (a[sortConfig.key] < b[sortConfig.key]) {
        return sortConfig.direction === 'asc' ? -1 : 1;
      }
      if (a[sortConfig.key] > b[sortConfig.key]) {
        return sortConfig.direction === 'asc' ? 1 : -1;
      }
      return 0;
    });
  }, [data, sortConfig]);

  // Client-side search across the visible columns (opt-in via `searchable`).
  const filteredData = useMemo(() => {
    if (!searchable || !query.trim()) return sortedData;
    const q = query.trim().toLowerCase();
    return sortedData.filter(row =>
      columns.some(col => String(row[col.key] ?? '').toLowerCase().includes(q))
    );
  }, [sortedData, query, searchable, columns]);

  const isAllSelected = selectable && filteredData.length > 0 && filteredData.every(row => selectedIds?.has(row.id));
  const isIndeterminate = selectable && !isAllSelected && filteredData.some(row => selectedIds?.has(row.id));

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData('text/plain', index.toString());
    e.currentTarget.classList.add('opacity-50');
  };

  const handleDragEnd = (e: React.DragEvent) => {
    e.currentTarget.classList.remove('opacity-50');
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    const sourceIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
    
    if (sourceIndex === targetIndex) return;

    const newData = [...data];
    const [movedItem] = newData.splice(sourceIndex, 1);
    newData.splice(targetIndex, 0, movedItem);

    setData(newData);

    if (onReorderItem) {
      onReorderItem(sourceIndex, targetIndex);
    } else if (onReorder) {
      // Re-calculate serials (assuming 1-indexed based on array position)
      const reorderedItems = newData.map((item, index) => ({
        id: item.id,
        serial: index + 1
      }));
      onReorder(reorderedItems);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onUploadCsv) {
      onUploadCsv(file);
    }
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="space-y-4">
      {(title || onDownloadCsv || onUploadCsv || onFetchApi || onAdd) && (
        <div className="flex items-center justify-between">
          {title && <h2 className="text-2xl font-semibold text-foreground tracking-tight">{title}</h2>}
          
          <div className="flex space-x-2">
            {customActions}
            {onDownloadCsv && (
              <button onClick={onDownloadCsv} className="flex items-center bg-accent text-accent-foreground px-4 py-2 rounded-md hover:opacity-90 font-medium text-sm transition-opacity shadow-sm">
                <Download className="w-4 h-4 mr-2" />
                Download CSV
              </button>
            )}
            
            {onUploadCsv && (
              <>
                <input type="file" accept=".csv" className="hidden" ref={fileInputRef} onChange={handleFileChange} />
                <button onClick={() => fileInputRef.current?.click()} className="flex items-center bg-secondary text-secondary-foreground px-4 py-2 rounded-md hover:opacity-90 font-medium text-sm transition-opacity shadow-sm">
                  <Upload className="w-4 h-4 mr-2" />
                  Upload CSV
                </button>
              </>
            )}

            {onFetchApi && (
              <button onClick={onFetchApi} className="flex items-center bg-blue-600 text-white px-4 py-2 rounded-md hover:opacity-90 font-medium text-sm transition-opacity shadow-sm">
                <Upload className="w-4 h-4 mr-2" />
                {fetchApiLabel || 'Fetch API'}
              </button>
            )}

            {onAdd && (
              <button onClick={onAdd} className="bg-primary text-primary-foreground px-4 py-2 rounded-md hover:opacity-90 font-medium text-sm transition-opacity shadow-sm">
                Add New
              </button>
            )}
          </div>
        </div>
      )}

      {(searchable || filters) && (
        <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
          {searchable && (
            <div className="relative flex-1 md:min-w-56">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder || 'Search...'}
                className="w-full pl-9 pr-3 py-2.5 bg-input/20 border border-input rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          )}
          {filters && (
            <div className="flex flex-wrap items-center gap-3">
              {filters}
            </div>
          )}
        </div>
      )}

      <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-muted text-muted-foreground text-sm border-b border-border">
                {reorderEnabled && <th className="px-4 py-3 w-12 text-center"></th>}
                {selectable && (
                  <th className="px-4 py-3 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={!!isAllSelected}
                      ref={el => { if (el) el.indeterminate = !!isIndeterminate; }}
                      onChange={() => onToggleSelectAll && onToggleSelectAll(filteredData.map(row => row.id), !isAllSelected)}
                      className="cursor-pointer"
                    />
                  </th>
                )}
                {columns.map(col => (
                  <th key={col.key} className="px-6 py-3 font-semibold">
                    <div 
                      className={`flex items-center space-x-1 ${col.sortable !== false ? 'cursor-pointer hover:text-foreground select-none' : ''}`}
                      onClick={() => col.sortable !== false && handleSort(col.key)}
                    >
                      <span>{col.label}</span>
                      {col.sortable !== false && (
                        <span className="text-muted-foreground/50">
                          {sortConfig?.key === col.key ? (
                            sortConfig.direction === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />
                          ) : (
                            <ArrowUpDown className="w-4 h-4 opacity-50" />
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
                <th className="px-6 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredData.map((row, index) => (
                <tr 
                  key={row.id || index}
                  draggable={reorderEnabled}
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragEnd={handleDragEnd}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, index)}
                  onClick={() => selectable ? (onToggleSelect && onToggleSelect(row.id)) : (onEdit && onEdit(row))}
                  className={`hover:bg-accent/50 transition-colors bg-card ${(onEdit || selectable) ? 'cursor-pointer' : ''}`}
                >
                  {reorderEnabled && (
                    <td className="px-4 py-4 cursor-grab active:cursor-grabbing text-muted-foreground flex items-center justify-center">
                      <GripVertical className="w-4 h-4 opacity-50 hover:opacity-100" />
                    </td>
                  )}

                  {selectable && (
                    <td className="px-4 py-4 text-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={!!selectedIds?.has(row.id)}
                        onChange={() => onToggleSelect && onToggleSelect(row.id)}
                        className="cursor-pointer"
                      />
                    </td>
                  )}

                  {columns.map(col => (
                    <td key={col.key} className="px-6 py-4 text-sm text-foreground">
                      {row[col.key]}
                    </td>
                  ))}

                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end space-x-2">
                      {onView && !selectable && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onView(row); }}
                          className="p-1 text-muted-foreground hover:text-primary transition-colors"
                          title="View"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      )}
                      {onEdit && !selectable && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onEdit(row); }}
                          className="p-1 text-muted-foreground hover:text-primary transition-colors"
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                      {onDelete && !selectable && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onDelete(row); }}
                          className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              
              {filteredData.length === 0 && (
                <tr>
                  <td colSpan={columns.length + (reorderEnabled ? 1 : 0) + (selectable ? 1 : 0) + 1} className="px-6 py-8 text-center text-muted-foreground">
                    No data found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
