"use client";

import { useState, useRef, useMemo } from 'react';
import { GripVertical, Pencil, Trash2, Eye, Upload, Download, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

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
  onUploadCsv?: (file: File) => void;
  onDownloadCsv?: () => void;
  onAdd?: () => void;
  onEdit?: (row: any) => void;
  onDelete?: (row: any) => void;
  onView?: (row: any) => void;
  onFetchApi?: () => void;
  customActions?: React.ReactNode;
}

export default function DataTable({
  columns,
  data: initialData,
  title,
  onReorder,
  onUploadCsv,
  onDownloadCsv,
  onAdd,
  onEdit,
  onDelete,
  onView,
  onFetchApi,
  customActions
}: DataTableProps) {
  const [data, setData] = useState(initialData);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

    if (onReorder) {
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
                Fetch API
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

      <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-muted text-muted-foreground text-sm border-b border-border">
                {onReorder && <th className="px-4 py-3 w-12 text-center"></th>}
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
              {sortedData.map((row, index) => (
                <tr 
                  key={row.id || index}
                  draggable={!!onReorder}
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragEnd={handleDragEnd}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, index)}
                  onClick={() => onEdit && onEdit(row)}
                  className={`hover:bg-accent/50 transition-colors bg-card ${onEdit ? 'cursor-pointer' : ''}`}
                >
                  {onReorder && (
                    <td className="px-4 py-4 cursor-grab active:cursor-grabbing text-muted-foreground flex items-center justify-center">
                      <GripVertical className="w-4 h-4 opacity-50 hover:opacity-100" />
                    </td>
                  )}

                  {columns.map(col => (
                    <td key={col.key} className="px-6 py-4 text-sm text-foreground">
                      {row[col.key]}
                    </td>
                  ))}

                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end space-x-2">
                      {onView && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onView(row); }}
                          className="p-1 text-muted-foreground hover:text-primary transition-colors"
                          title="View"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); onEdit && onEdit(row); }}
                        className="p-1 text-muted-foreground hover:text-primary transition-colors"
                        title="Edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onDelete && onDelete(row); }}
                        className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              
              {sortedData.length === 0 && (
                <tr>
                  <td colSpan={columns.length + (onReorder ? 2 : 1)} className="px-6 py-8 text-center text-muted-foreground">
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
