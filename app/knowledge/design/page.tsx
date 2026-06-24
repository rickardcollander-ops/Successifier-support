'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import CategoryIcon from '@/components/CategoryIcon';
import IconPicker from '@/components/IconPicker';

interface Config {
  accentColor: string;
  theme: 'light' | 'dark' | 'auto';
  logoUrl: string | null;
  headline: string;
  intro: string | null;
  layout: 'grid' | 'list';
  showSearch: boolean;
  footerText: string | null;
  supportUrl: string | null;
  supportLabel: string | null;
  chatEnabled: boolean;
  chatTitle: string;
  chatWelcome: string;
  chatPlaceholder: string;
  chatInstructions: string | null;
  chatFallback: string | null;
  chatSuggestions: string[];
}

interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  isPublic: boolean;
}

const DEFAULTS: Config = {
  accentColor: '#7C5CFF',
  theme: 'light',
  logoUrl: null,
  headline: 'Hur kan vi hjälpa dig?',
  intro: null,
  layout: 'grid',
  showSearch: true,
  footerText: null,
  supportUrl: null,
  supportLabel: null,
  chatEnabled: true,
  chatTitle: 'Fråga hjälpcentret',
  chatWelcome: 'Hej! Ställ en fråga så söker jag svar i vårt hjälpcenter.',
  chatPlaceholder: 'Skriv din fråga…',
  chatInstructions: null,
  chatFallback: null,
  chatSuggestions: [],
};

const inputClass =
  'w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#7C5CFF]';
const labelClass = 'block text-sm font-medium mb-2 text-slate-900 dark:text-slate-100';
const hintClass = 'text-xs text-slate-500 dark:text-slate-400 mt-1';

type Tab = 'design' | 'categories' | 'chatbot';

export default function HelpCenterDesignPage() {
  const [tab, setTab] = useState<Tab>('design');
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

  const tabs: { id: Tab; label: string }[] = [
    { id: 'design', label: 'Design' },
    { id: 'categories', label: 'Kategorier' },
    { id: 'chatbot', label: 'Chatbot' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/knowledge" className="text-sm text-[#7C5CFF] hover:underline">← Kunskapsbas</Link>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">Hjälpcentret</h1>
        </div>
        <a href="/help" target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300">
          Öppna hjälpcenter ↗
        </a>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t.id
                ? 'border-[#7C5CFF] text-[#7C5CFF]'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'design' && <DesignTab config={config} update={update} />}
      {tab === 'chatbot' && <ChatbotTab config={config} update={update} />}
      {tab === 'categories' && <CategoriesTab />}

      {tab !== 'categories' && (
        <div className="flex items-center gap-3">
          <button onClick={save} disabled={saving} className="px-4 py-2 bg-gradient-to-r from-[#7C5CFF] to-[#9F7BFF] text-white rounded-md hover:brightness-110 disabled:opacity-50 font-medium shadow-[0_0_15px_rgba(124,92,255,0.4)]">
            {saving ? 'Sparar…' : 'Spara'}
          </button>
          {saved && <span className="text-sm text-green-600 dark:text-green-400">Sparat ✓</span>}
        </div>
      )}
    </div>
  );
}

// --- Design tab ----------------------------------------------------------

function DesignTab({ config, update }: { config: Config; update: <K extends keyof Config>(k: K, v: Config[K]) => void }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
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

        <hr className="border-slate-200 dark:border-slate-700" />

        <div>
          <label className={labelClass}>Sidfotstext</label>
          <input type="text" value={config.footerText || ''} onChange={(e) => update('footerText', e.target.value || null)} className={inputClass} placeholder="© 2026 Ditt företag (lämna tom för standard)" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Support-länk (URL)</label>
            <input type="text" value={config.supportUrl || ''} onChange={(e) => update('supportUrl', e.target.value || null)} className={inputClass} placeholder="https://…/kontakt" />
          </div>
          <div>
            <label className={labelClass}>Support-text</label>
            <input type="text" value={config.supportLabel || ''} onChange={(e) => update('supportLabel', e.target.value || null)} className={inputClass} placeholder="Kontakta supporten" />
          </div>
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
              {[
                { name: 'Komma igång', icon: 'GraduationCap' },
                { name: 'Fakturering', icon: 'CreditCard' },
                { name: 'Konto', icon: 'User' },
                { name: 'Vanliga frågor', icon: 'HelpCircle' },
              ].map((c) => (
                <div key={c.name} className="flex items-center gap-3 p-4 rounded-xl border border-[color:var(--kb-border)] bg-[color:var(--kb-surface)]">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: 'color-mix(in srgb, var(--kb-accent) 14%, transparent)', color: 'var(--kb-accent)' }}>
                    <CategoryIcon name={c.icon} size={18} />
                  </span>
                  <div>
                    <div className="font-medium text-sm">{c.name}</div>
                    <div className="text-xs text-[color:var(--kb-muted)]">3 artiklar</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Chatbot tab ---------------------------------------------------------

function ChatbotTab({ config, update }: { config: Config; update: <K extends keyof Config>(k: K, v: Config[K]) => void }) {
  const setSuggestion = (i: number, v: string) => {
    const next = [...config.chatSuggestions];
    next[i] = v;
    update('chatSuggestions', next);
  };
  const addSuggestion = () => {
    if (config.chatSuggestions.length >= 6) return;
    update('chatSuggestions', [...config.chatSuggestions, '']);
  };
  const removeSuggestion = (i: number) => {
    update('chatSuggestions', config.chatSuggestions.filter((_, idx) => idx !== i));
  };

  return (
    <div className="max-w-2xl bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm p-6 space-y-5">
      <label className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
        <input type="checkbox" checked={config.chatEnabled} onChange={(e) => update('chatEnabled', e.target.checked)} className="w-4 h-4 text-[#7C5CFF] rounded" />
        Aktivera AI-chatbot i hjälpcentret
      </label>

      <div className={config.chatEnabled ? 'space-y-5' : 'space-y-5 opacity-50 pointer-events-none'}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Chattens rubrik</label>
            <input type="text" value={config.chatTitle} onChange={(e) => update('chatTitle', e.target.value)} className={inputClass} placeholder="Fråga hjälpcentret" />
          </div>
          <div>
            <label className={labelClass}>Platshållare i fältet</label>
            <input type="text" value={config.chatPlaceholder} onChange={(e) => update('chatPlaceholder', e.target.value)} className={inputClass} placeholder="Skriv din fråga…" />
          </div>
        </div>

        <div>
          <label className={labelClass}>Välkomstmeddelande</label>
          <textarea value={config.chatWelcome} onChange={(e) => update('chatWelcome', e.target.value)} className={`${inputClass} h-16 resize-none`} placeholder="Hej! Ställ en fråga…" />
        </div>

        <div>
          <label className={labelClass}>Instruktioner till boten</label>
          <textarea value={config.chatInstructions || ''} onChange={(e) => update('chatInstructions', e.target.value || null)} className={`${inputClass} h-28 resize-y`} placeholder="T.ex. tonfall, hur den ska tilltala kunder, vad den ska lyfta fram, språk…" />
          <p className={hintClass}>
            Styr botens ton och fokus. Säkerhetsreglerna gäller alltid före: boten svarar bara
            utifrån publicerade artiklar och hittar aldrig på.
          </p>
        </div>

        <div>
          <label className={labelClass}>Svar när inget hittas</label>
          <textarea value={config.chatFallback || ''} onChange={(e) => update('chatFallback', e.target.value || null)} className={`${inputClass} h-16 resize-none`} placeholder="Lämna tom för standardtext. T.ex: Jag hittar inget svar – kontakta oss på…" />
        </div>

        <div>
          <label className={labelClass}>Förslagsfrågor (visas som knappar)</label>
          <div className="space-y-2">
            {config.chatSuggestions.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <input type="text" value={s} onChange={(e) => setSuggestion(i, e.target.value)} className={inputClass} placeholder="T.ex. Hur säger jag upp mitt abonnemang?" />
                <button type="button" onClick={() => removeSuggestion(i)} className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded" title="Ta bort">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            {config.chatSuggestions.length < 6 && (
              <button type="button" onClick={addSuggestion} className="flex items-center gap-1 text-sm text-[#7C5CFF] hover:underline">
                <Plus className="w-4 h-4" /> Lägg till förslag
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Categories tab ------------------------------------------------------

function CategoriesTab() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    fetch('/api/knowledge/categories')
      .then((r) => (r.ok ? r.json() : { categories: [] }))
      .then((d) => setCategories(d.categories || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const patch = async (id: string, data: Partial<Category>) => {
    setCategories((cs) => cs.map((c) => (c.id === id ? { ...c, ...data } : c)));
    await fetch(`/api/knowledge/categories/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  };

  const remove = async (id: string) => {
    if (!confirm('Ta bort kategorin? Artiklarna behålls men tappar kopplingen.')) return;
    setCategories((cs) => cs.filter((c) => c.id !== id));
    await fetch(`/api/knowledge/categories/${id}`, { method: 'DELETE' });
  };

  const add = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/knowledge/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), icon: 'HelpCircle', sortOrder: categories.length }),
      });
      if (res.ok) {
        setNewName('');
        load();
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="text-slate-600 dark:text-slate-400">Laddar kategorier…</div>;

  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Välj ikon, namn och ordning för varje kategori. Ändringar sparas direkt.
      </p>

      <div className="space-y-2">
        {categories.map((c) => (
          <div key={c.id} className="flex items-center gap-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-3">
            <GripVertical className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#7C5CFF]/10 text-[#7C5CFF]">
              <CategoryIcon name={c.icon} size={18} />
            </span>
            <IconPicker value={c.icon} onChange={(name) => patch(c.id, { icon: name })} />
            <input
              type="text"
              value={c.name}
              onChange={(e) => setCategories((cs) => cs.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)))}
              onBlur={(e) => patch(c.id, { name: e.target.value })}
              className="flex-1 px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
            />
            <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
              <input type="checkbox" checked={c.isPublic} onChange={(e) => patch(c.id, { isPublic: e.target.checked })} className="w-4 h-4 text-[#7C5CFF] rounded" />
              Publik
            </label>
            <button type="button" onClick={() => remove(c.id)} className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded flex-shrink-0" title="Ta bort">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        {categories.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">Inga kategorier ännu.</p>
        )}
      </div>

      <div className="flex items-center gap-2 pt-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          placeholder="Ny kategori…"
          className={inputClass}
        />
        <button type="button" onClick={add} disabled={busy || !newName.trim()} className="flex items-center gap-1 px-4 py-2 bg-[#7C5CFF] text-white rounded-md hover:brightness-110 disabled:opacity-50 whitespace-nowrap">
          <Plus className="w-4 h-4" /> Lägg till
        </button>
      </div>
    </div>
  );
}
