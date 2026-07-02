import { useState } from 'react';
import { AlertCircle } from 'lucide-react';

export function useConfirm() {
  const [isOpen, setIsOpen] = useState(false);
  const [config, setConfig] = useState({ title: '', message: '', onConfirm: () => {} });

  const confirm = (title: string, message: string, onConfirm: () => void) => {
    setConfig({ title, message, onConfirm });
    setIsOpen(true);
  };

  const ConfirmModal = () => {
    if (!isOpen) return null;
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
        <div className="bg-card border border-border shadow-lg rounded-lg w-full max-w-sm p-6 animate-in zoom-in-95 duration-200 m-4">
          <div className="flex items-center gap-3 mb-2 text-destructive">
            <AlertCircle className="w-5 h-5" />
            <h3 className="text-lg font-semibold text-foreground">{config.title}</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-6 pl-8">{config.message}</p>
          <div className="flex justify-end gap-3">
            <button 
              onClick={() => setIsOpen(false)} 
              className="px-4 py-2 text-sm font-medium rounded-md bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
            >
              Cancel
            </button>
            <button 
              onClick={() => { config.onConfirm(); setIsOpen(false); }} 
              className="px-4 py-2 text-sm font-medium rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
            >
              Confirm
            </button>
          </div>
        </div>
      </div>
    );
  };

  return { confirm, ConfirmModal };
}
