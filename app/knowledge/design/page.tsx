'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Config {
  accentColor: string;
  theme: 'light' | 'dark' | 'auto';
  logoUrl: string | null;
  headline: string;
  intro: string | null;
  layout: 'grid' | 'list';
  showSearch: boolean;
}

const DEFAULTS: Config = {
  accentColor: '#7C5CFF',
  theme: 'light',
  logoUrl: null,
  headline: 'Hur kan vi hjälpa dig?',
  intro: null,
  layout: 'grid',
  showSearch: true,
};

const inputClass =
  'w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#7C5CFF]';
const labelClass = 'block text-sm font-medium mb-2 text-slate-900 dark:text-slate-100';

export default function HelpCenterDesignPage() {
  const [config, setConfig] = useState<Config>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/knowledge/help-center')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.config && setConfig({ ...DEFAULTS, ...d.config }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const update = <K extends keyof Config>(key: K, value: Config[K]) => {
    setConfig((c) => ({ ...c, [key]: value }));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch('/api/knowledge/help-center', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (res.ok) {
        const d = await res.json();
        if (d?.config) setConfig({ ...DEFAULTS, ...d.config });
        setSaved(true);
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-96 text-slate-600 dark:text-slate-400">Laddar…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/knowledge" className="text-sm text-[#7C5CFF] hover:underline">← Kunskapsbas</Link>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">Hjälpcentrets design</h1>
        </div>
        <a href="/help" target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300">
          Öppna hjälpcenter ↗
        </a>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Form */}
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm p-6 space-y-4">
          <div>
            <label className={labelClass}>Accentfärg</label>
            <div className="flex items-center gap-3">
              <input type="color" value={config.accentColor} onChange={(e) => update('accentColor', e.target.value)} className="h-10 w-14 rounded border border-slate-300 dark:border-slate-600 bg-transparent" />
              <input type="text" value={config.accentColor} onChange={(e) => update('accentColor', e.target.value)} className={inputClass} />
            </div>
          </div>

          <div>
            <label className={labelClass}>Tema</label>
            <select value={config.theme} onChange={(e) => update('theme', e.target.value as Config['theme'])} className={inputClass}>
              <option value="light">Ljust</option>
              <option value="dark">Mörkt</option>
              <option value="auto">Auto (följer besökarens system)</option>
            </select>
          </div>

          <div>
            <label className={labelClass}>Layout för kategorier</label>
            <select value={config.layout} onChange={(e) => update('layout', e.target.value as Config['layout'])} className={inputClass}>
              <option value="grid">Rutnät</option>
              <option value="list">Lista</option>
            </select>
          </div>

          <div>
            <label className={labelClass}>Logga (URL)</label>
            <input type="text" value={config.logoUrl || ''} onChange={(e) => update('logoUrl', e.target.value || null)} className={inputClass} placeholder="https://…/logo.svg (lämna tom för varumärkesnamn)" />
          </div>

          <div>
            <label className={labelClass}>Rubrik</label>
            <input type="text" value={config.headline} onChange={(e) => update('headline', e.target.value)} className={inputClass} placeholder="Hur kan vi hjälpa dig?" />
          </div>

          <div>
            <label className={labelClass}>Introtext</label>
            <textarea value={config.intro || ''} onChange={(e) => update('intro', e.target.value || null)} className={`${inputClass} h-20 resize-none`} placeholder="Valfri text under rubriken…" />
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-900 dark:text-slate-100">
            <input type="checkbox" checked={config.showSearch} onChange={(e) => update('showSearch', e.target.checked)} className="w-4 h-4 text-[#7C5CFF] rounded" />
            Visa sökruta
          </label>

          <div className="flex items-center gap-3 pt-2">
            <button onClick={save} disabled={saving} className="px-4 py-2 bg-gradient-to-r from-[#7C5CFF] to-[#9F7BFF] text-white rounded-md hover:brightness-110 disabled:opacity-50 font-medium shadow-[0_0_15px_rgba(124,92,255,0.4)]">
              {saving ? 'Sparar…' : 'Spara design'}
            </button>
            {saved && <span className="text-sm text-green-600 dark:text-green-400">Sparat ✓</span>}
          </div>
        </div>

        {/* Live preview */}
        <div>
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Förhandsvisning</p>
          <div
            className="kb-root rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden"
            data-theme={config.theme}
            style={{ ['--kb-accent' as string]: config.accentColor } as React.CSSProperties}
          >
            <div className="border-b border-[color:var(--kb-border)] bg-[color:var(--kb-surface)] px-5 py-4 font-semibold">
              {config.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={config.logoUrl} alt="Logo" className="h-7 w-auto" />
              ) : (
                <span>Varumärke <span style={{ color: 'var(--kb-accent)' }}>Hjälpcenter</span></span>
              )}
            </div>
            <div className="p-6 space-y-4">
              <h2 className="text-xl font-bold text-center">{config.headline || 'Hur kan vi hjälpa dig?'}</h2>
              {config.intro && <p className="text-center text-sm text-[color:var(--kb-muted)]">{config.intro}</p>}
              {config.showSearch && (
                <div className="border border-[color:var(--kb-border)] bg-[color:var(--kb-surface)] rounded-xl px-4 py-3 text-sm text-[color:var(--kb-muted)]">
                  Sök i hjälpcentret…
                </div>
              )}
              <div className={config.layout === 'list' ? 'space-y-2' : 'grid grid-cols-2 gap-3'}>
                {['Komma igång', 'Fakturering', 'Konto', 'Vanliga frågor'].map((name) => (
                  <div key={name} className="p-4 rounded-xl border border-[color:var(--kb-border)] bg-[color:var(--kb-surface)]">
                    <div className="font-medium text-sm">{name}</div>
                    <div className="text-xs text-[color:var(--kb-muted)] mt-1">3 artiklar</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
