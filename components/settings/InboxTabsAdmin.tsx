'use client';

import { useEffect, useMemo, useState } from 'react';
import { LayoutList, ChevronUp, ChevronDown, Trash2, Plus, Eye, EyeOff } from 'lucide-react';
import { t } from '@/lib/i18n';
import { product } from '@/lib/products';
import {
  buildTabList,
  customTabSlug,
  BUILTIN_TAB_KEYS,
  type InboxTabConfig,
  type StoredTab,
  type TabRuleField,
  type TabRuleOp,
} from '@/lib/inbox-tabs';

const FIELD_OPTIONS: { value: TabRuleField; label: string }[] = [
  { value: 'status', label: t('Status') },
  { value: 'priority', label: t('Prioritet') },
  { value: 'sender', label: t('Avsändare (e-post)') },
  { value: 'subject', label: t('Ämne') },
];

const OPS_FOR_FIELD: Record<TabRuleField, { value: TabRuleOp; label: string }[]> = {
  status: [
    { value: 'in', label: t('är någon av') },
    { value: 'not_in', label: t('är inte någon av') },
  ],
  priority: [
    { value: 'in', label: t('är någon av') },
    { value: 'not_in', label: t('är inte någon av') },
  ],
  sender: [
    { value: 'contains', label: t('innehåller') },
    { value: 'not_contains', label: t('innehåller inte') },
  ],
  subject: [
    { value: 'contains', label: t('innehåller') },
    { value: 'not_contains', label: t('innehåller inte') },
  ],
};

const VALUE_HINT: Record<TabRuleField, string> = {
  status: 'new, in_progress, review, sent, closed, duplicate',
  priority: 'urgent, high, normal, low',
  sender: 'stripe.com',
  subject: 'återbetalning',
};

export default function InboxTabsAdmin() {
  // Built-in labels mirror what the inbox renders so renames start from the
  // real defaults.
  const defaults = useMemo(() => {
    const labels: Record<string, string> = {
      urgent: t('Akut ärende'),
      new: t('Nya'),
      in_progress: t('Öppna'),
      review: t('Granskning'),
      sent: t('Skickade'),
      closed: t('Stängda'),
      all: t('Alla'),
      billecta: product.vendorFolder.label,
      bounce: t('Studsade'),
      duplicate: t('Dubletter'),
      archived: t('Arkiverade'),
    };
    return BUILTIN_TAB_KEYS.map((k) => ({ key: k, label: labels[k] ?? k }));
  }, []);

  const [tabs, setTabs] = useState<InboxTabConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/inbox-tabs');
        const data = res.ok ? await res.json() : { tabs: [] };
        setTabs(buildTabList(defaults, Array.isArray(data.tabs) ? data.tabs : []));
      } catch {
        setTabs(buildTabList(defaults, []));
      } finally {
        setLoading(false);
      }
    })();
    // defaults is stable (built once)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (i: number, patch: Partial<InboxTabConfig>) =>
    setTabs((prev) => prev.map((tb, idx) => (idx === i ? { ...tb, ...patch } : tb)));

  const move = (i: number, dir: -1 | 1) => {
    setTabs((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const removeCustom = (i: number) =>
    setTabs((prev) => prev.filter((_, idx) => idx !== i));

  const addCustom = () => {
    setTabs((prev) => [
      ...prev,
      {
        key: customTabSlug('tab'),
        label: t('Ny flik'),
        order: prev.length,
        visible: true,
        isCustom: true,
        rules: { match: 'all', conditions: [{ field: 'status', op: 'in', value: '' }] },
      },
    ]);
  };

  // --- rule editing (custom tabs only) ---
  const setMatch = (i: number, match: 'all' | 'any') =>
    update(i, { rules: { match, conditions: tabs[i].rules?.conditions ?? [] } });

  const addCondition = (i: number) =>
    update(i, {
      rules: {
        match: tabs[i].rules?.match ?? 'all',
        conditions: [...(tabs[i].rules?.conditions ?? []), { field: 'status', op: 'in', value: '' }],
      },
    });

  const updateCondition = (i: number, ci: number, patch: Partial<{ field: TabRuleField; op: TabRuleOp; value: string }>) =>
    update(i, {
      rules: {
        match: tabs[i].rules?.match ?? 'all',
        conditions: (tabs[i].rules?.conditions ?? []).map((c, idx) => {
          if (idx !== ci) return c;
          const merged = { ...c, ...patch } as { field: TabRuleField; op: TabRuleOp; value: string | string[] };
          // When the field changes, snap the operator to a valid one.
          if (patch.field) merged.op = OPS_FOR_FIELD[patch.field][0].value;
          return merged;
        }),
      },
    });

  const removeCondition = (i: number, ci: number) =>
    update(i, {
      rules: {
        match: tabs[i].rules?.match ?? 'all',
        conditions: (tabs[i].rules?.conditions ?? []).filter((_, idx) => idx !== ci),
      },
    });

  const save = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const payload: StoredTab[] = tabs.map((tb, i) => ({
        key: tb.key,
        label: tb.label.trim() || tb.key,
        order: i,
        visible: tb.visible,
        isCustom: tb.isCustom,
        rules: tb.isCustom
          ? {
              match: tb.rules?.match ?? 'all',
              conditions: (tb.rules?.conditions ?? []).map((c) => ({
                field: c.field,
                op: c.op,
                // Split comma-separated input into a list of values.
                value: String(Array.isArray(c.value) ? c.value.join(',') : c.value)
                  .split(',')
                  .map((v) => v.trim())
                  .filter(Boolean),
              })),
            }
          : null,
      }));
      const res = await fetch('/api/inbox-tabs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabs: payload }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setStatus(`${t('Fel:')} ${err.error || res.status}`);
        return;
      }
      setStatus(t('Sparat! Ladda om inkorgen för att se ändringarna.'));
    } catch {
      setStatus(t('Nätverksfel vid sparande'));
    } finally {
      setSaving(false);
    }
  };

  const valueToString = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v.join(', ') : (v ?? '');

  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">{t('Inkorgsflikar')}</h2>
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-r from-violet-500 to-violet-600 flex items-center justify-center flex-shrink-0">
            <LayoutList className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="font-medium text-slate-900 dark:text-slate-100">{t('Anpassa flikarna i inkorgen')}</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
              {t('Visa/dölj, byt namn och ändra ordning på flikarna. Skapa egna flikar med regler (avsändare, status, prioritet, ämne). Sparas för hela teamet i den här miljön.')}
            </p>
          </div>
          <button
            onClick={save}
            disabled={saving || loading}
            className="text-sm px-4 py-2 rounded-md bg-[#7C5CFF] text-white hover:bg-[#6B4FE0] disabled:opacity-50 whitespace-nowrap"
          >
            {saving ? t('Sparar…') : t('Spara')}
          </button>
        </div>

        {status && (
          <div className="px-4 py-2 text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-700">
            {status}
          </div>
        )}

        {loading ? (
          <div className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">{t('Laddar…')}</div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {tabs.map((tb, i) => (
              <div key={tb.key} className="p-4">
                <div className="flex items-center gap-2">
                  <div className="flex flex-col">
                    <button
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-20"
                      title={t('Flytta upp')}
                    >
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => move(i, 1)}
                      disabled={i === tabs.length - 1}
                      className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-20"
                      title={t('Flytta ner')}
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>

                  <input
                    type="text"
                    value={tb.label}
                    onChange={(e) => update(i, { label: e.target.value })}
                    className="flex-1 px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                  />

                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${tb.isCustom ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'}`}>
                    {tb.isCustom ? t('Egen') : t('Standard')}
                  </span>

                  <button
                    onClick={() => update(i, { visible: !tb.visible })}
                    className={`p-1.5 rounded-md ${tb.visible ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'} hover:bg-slate-100 dark:hover:bg-slate-700`}
                    title={tb.visible ? t('Dölj fliken') : t('Visa fliken')}
                  >
                    {tb.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>

                  {tb.isCustom && (
                    <button
                      onClick={() => removeCustom(i)}
                      className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-900/20"
                      title={t('Ta bort fliken')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {tb.isCustom && (
                  <div className="mt-3 ml-8 rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-slate-50 dark:bg-slate-800/40">
                    <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 mb-2">
                      <span>{t('Visa ärenden som matchar')}</span>
                      <select
                        value={tb.rules?.match ?? 'all'}
                        onChange={(e) => setMatch(i, e.target.value as 'all' | 'any')}
                        className="px-2 py-1 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900"
                      >
                        <option value="all">{t('alla villkor')}</option>
                        <option value="any">{t('något villkor')}</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-2">
                      {(tb.rules?.conditions ?? []).map((c, ci) => (
                        <div key={ci} className="flex flex-wrap items-center gap-2">
                          <select
                            value={c.field}
                            onChange={(e) => updateCondition(i, ci, { field: e.target.value as TabRuleField })}
                            className="px-2 py-1 text-xs rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900"
                          >
                            {FIELD_OPTIONS.map((f) => (
                              <option key={f.value} value={f.value}>{f.label}</option>
                            ))}
                          </select>
                          <select
                            value={c.op}
                            onChange={(e) => updateCondition(i, ci, { op: e.target.value as TabRuleOp })}
                            className="px-2 py-1 text-xs rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900"
                          >
                            {OPS_FOR_FIELD[c.field].map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                          <input
                            type="text"
                            value={valueToString(c.value)}
                            onChange={(e) => updateCondition(i, ci, { value: e.target.value })}
                            placeholder={VALUE_HINT[c.field]}
                            className="flex-1 min-w-[140px] px-2 py-1 text-xs rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900"
                          />
                          <button
                            onClick={() => removeCondition(i, ci)}
                            className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                            title={t('Ta bort villkor')}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>

                    <button
                      onClick={() => addCondition(i)}
                      className="mt-2 inline-flex items-center gap-1 text-xs text-[#7C5CFF] hover:text-[#9F7BFF]"
                    >
                      <Plus className="w-3.5 h-3.5" /> {t('Lägg till villkor')}
                    </button>
                    <p className="mt-2 text-[11px] text-slate-400">
                      {t('Flera värden separeras med komma. Avsändare/ämne matchar delsträng.')}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30">
          <button
            onClick={addCustom}
            disabled={loading}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#7C5CFF] hover:text-[#9F7BFF]"
          >
            <Plus className="w-4 h-4" /> {t('Lägg till egen flik')}
          </button>
        </div>
      </div>
    </div>
  );
}
