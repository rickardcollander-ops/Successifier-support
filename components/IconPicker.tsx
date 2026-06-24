'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import CategoryIcon, { CATEGORY_ICON_NAMES } from '@/components/CategoryIcon';

// Visual icon picker: shows the selected glyph and opens a grid of all
// available category icons to choose from (so you actually see the icons, not
// just their names). Used in the help-center category editor.
export default function IconPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Välj ikon"
        className="flex items-center gap-1 h-9 px-2 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-[#7C5CFF] hover:border-[#7C5CFF]"
      >
        <CategoryIcon name={value} size={18} />
        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-56 p-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-lg grid grid-cols-6 gap-1 max-h-56 overflow-y-auto">
          {CATEGORY_ICON_NAMES.map((name) => (
            <button
              key={name}
              type="button"
              title={name}
              onClick={() => {
                onChange(name);
                setOpen(false);
              }}
              className={`flex items-center justify-center h-8 w-8 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 ${
                value === name ? 'bg-[#7C5CFF]/15 text-[#7C5CFF]' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <CategoryIcon name={name} size={18} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
