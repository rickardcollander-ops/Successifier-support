'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save, Trash2, Plus } from 'lucide-react';
import type { ProductConfig, AgentColor } from '@/lib/products';

// Superadmin editor for one tenant's runtime configuration
// (Tenant.settings). Loads the tenant's EFFECTIVE config (defaults + preset
// + stored settings), lets the operator edit it as a form, and saves the
// full object back as the tenant's settings via
// PATCH /api/admin/tenants/:id — live within ~30s (config cache TTL),
// no redeploy.

const KNOWN_INTEGRATIONS = ['stripe', 'billecta', 'retool', 'resend', 'gmail', 'postman'];

interface AgentRow {
  name: string;
  signature: string;
  color: string;
}

interface BillingForm {
  plan: string;
  billingStatus: string;
  trialEndsAt: string; // yyyy-mm-dd or ''
  stripeCustomerId: string;
  stripeSubscriptionId: string;
}

interface FormState {
  displayName: string;
  brandName: string;
  language: 'sv' | 'en';
  supportName: string;
  fromName: string;
  apiKeyPrefix: string;
  apiBaseDomain: string;
  integrations: string[];
  translateIncoming: boolean;
  sendConfirmation: boolean;
  allowedDomains: string;
  adminEmails: string;
  agents: AgentRow[];
  vendorLabel: string;
  vendorSenders: string;
  ticketCategories: string;
  confirmationGreeting: string;
  confirmationBody: string;
  confirmationSignoff: string;
}

// Derive a slightly darker border from a hex background so the operator
// only has to pick one color per agent.
function darken(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const f = (c: number) => Math.max(0, Math.round(c * 0.82));
  const r = f((n >> 16) & 0xff);
  const g = f((n >> 8) & 0xff);
  const b = f(n & 0xff);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0').toUpperCase()}`;
}

function toForm(config: ProductConfig): FormState {
  return {
    displayName: config.displayName,
    brandName: config.brandName,
    language: config.language,
    supportName: config.supportName,
    fromName: config.fromName,
    apiKeyPrefix: config.apiKeyPrefix,
    apiBaseDomain: config.apiBaseDomain,
    integrations: [...config.integrations],
    translateIncoming: config.translateIncoming,
    sendConfirmation: config.sendConfirmation,
    allowedDomains: config.allowedDomains.join(', '),
    adminEmails: config.adminEmails.join(', '),
    agents: config.agents.map((name) => ({
      name,
      signature: config.agentSignatures[name] ?? '',
      color: config.agentColors[name]?.bg ?? '#7C5CFF',
    })),
    vendorLabel: config.vendorFolder.label,
    vendorSenders: config.vendorFolder.senders.join(', '),
    ticketCategories: (config.ticketCategories ?? []).join('\n'),
    confirmationGreeting: config.confirmation.greeting,
    confirmationBody: config.confirmation.bodyLines.join('\n'),
    confirmationSignoff: config.confirmation.signoff,
  };
}

function splitList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function toSettings(form: FormState): Record<string, unknown> {
  const agents = form.agents.map((a) => a.name.trim()).filter(Boolean);
  const agentSignatures: Record<string, string> = {};
  const agentColors: Record<string, AgentColor> = {};
  for (const a of form.agents) {
    const name = a.name.trim();
    if (!name) continue;
    if (a.signature.trim()) agentSignatures[name] = a.signature;
    agentColors[name] = { bg: a.color, border: darken(a.color), text: '#FFFFFF' };
  }
  return {
    displayName: form.displayName.trim(),
    brandName: form.brandName.trim(),
    language: form.language,
    supportName: form.supportName.trim(),
    fromName: form.fromName.trim(),
    apiKeyPrefix: form.apiKeyPrefix.trim(),
    apiBaseDomain: form.apiBaseDomain.trim(),
    integrations: form.integrations,
    translateIncoming: form.translateIncoming,
    sendConfirmation: form.sendConfirmation,
    allowedDomains: splitList(form.allowedDomains),
    adminEmails: splitList(form.adminEmails),
    agents,
    agentSignatures,
    agentColors,
    vendorFolder: {
      label: form.vendorLabel.trim(),
      senders: splitList(form.vendorSenders),
    },
    ticketCategories: form.ticketCategories.split('\n').map((l) => l.trim()).filter(Boolean),
    confirmation: {
      greeting: form.confirmationGreeting,
      bodyLines: form.confirmationBody.split('\n').map((l) => l.trim()).filter(Boolean),
      signoff: form.confirmationSignoff,
    },
  };
}

export default function TenantSettingsEditor({
  tenantId,
  onSaved,
}: {
  tenantId: string;
  onSaved?: () => void;
}) {
  const [form, setForm] = useState<FormState | null>(null);
  const [billing, setBilling] = useState<BillingForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setForm(null);
    setError(null);
    fetch(`/api/admin/tenants/${tenantId}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Kunde inte hämta tenant (${res.status})`);
        if (cancelled) return;
        setForm(toForm(data.effectiveConfig as ProductConfig));
        const b = data.billing ?? {};
        setBilling({
          plan: b.plan ?? 'trial',
          billingStatus: b.billingStatus ?? 'trialing',
          trialEndsAt: b.trialEndsAt ? String(b.trialEndsAt).slice(0, 10) : '',
          stripeCustomerId: b.stripeCustomerId ?? '',
          stripeSubscriptionId: b.stripeSubscriptionId ?? '',
        });
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Något gick fel');
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.displayName,
          settings: toSettings(form),
          ...(billing
            ? {
                billing: {
                  plan: billing.plan,
                  billingStatus: billing.billingStatus,
                  trialEndsAt: billing.trialEndsAt || null,
                  stripeCustomerId: billing.stripeCustomerId || null,
                  stripeSubscriptionId: billing.stripeSubscriptionId || null,
                },
              }
            : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Kunde inte spara (${res.status})`);
      setSavedAt(Date.now());
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Något gick fel');
    } finally {
      setSaving(false);
    }
  };

  if (error && !form) return <p className="text-sm text-red-400 py-4">{error}</p>;
  if (!form)
    return (
      <div className="flex items-center gap-2 py-4 text-slate-400 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Laddar konfiguration…
      </div>
    );

  return (
    <div className="mt-4 space-y-6 border-t border-white/10 pt-5">
      {/* Varumärke */}
      <Section title="Varumärke">
        <Field label="Visningsnamn (UI)">
          <Input value={form.displayName} onChange={(v) => set('displayName', v)} />
        </Field>
        <Field label="Varumärke (AI-svar)">
          <Input value={form.brandName} onChange={(v) => set('brandName', v)} />
        </Field>
        <Field label="Supportnamn (avsändare/sign-off)">
          <Input value={form.supportName} onChange={(v) => set('supportName', v)} />
        </Field>
        <Field label="Från-namn (utgående mail)">
          <Input value={form.fromName} onChange={(v) => set('fromName', v)} />
        </Field>
        <Field label="Språk">
          <select
            value={form.language}
            onChange={(e) => set('language', e.target.value as 'sv' | 'en')}
            className="rounded-lg border border-white/10 bg-[#0B0F1A] px-3 py-2 text-sm focus:border-[#7C5CFF] focus:outline-none"
          >
            <option value="sv">Svenska</option>
            <option value="en">Engelska</option>
          </select>
        </Field>
      </Section>

      {/* Inloggning */}
      <Section title="Inloggning & behörighet">
        <Field label="Tillåtna e-postdomäner (kommaseparerade)" wide>
          <Input value={form.allowedDomains} onChange={(v) => set('allowedDomains', v)} placeholder="kund.se, kund.com" />
        </Field>
        <Field label="Admin-e-postadresser (kommaseparerade)" wide>
          <Input value={form.adminEmails} onChange={(v) => set('adminEmails', v)} placeholder="anna@kund.se" />
        </Field>
      </Section>

      {/* Integrationer */}
      <Section title="Integrationer">
        <div className="col-span-full flex flex-wrap gap-2">
          {KNOWN_INTEGRATIONS.map((type) => {
            const active = form.integrations.includes(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() =>
                  set(
                    'integrations',
                    active
                      ? form.integrations.filter((t) => t !== type)
                      : [...form.integrations, type],
                  )
                }
                className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
                  active
                    ? 'border-[#7C5CFF] bg-[#7C5CFF]/20 text-[#C9B8FF]'
                    : 'border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/25'
                }`}
              >
                {type}
              </button>
            );
          })}
        </div>
        <Toggle
          label="Översätt inkommande mail till teamets språk"
          checked={form.translateIncoming}
          onChange={(v) => set('translateIncoming', v)}
        />
      </Section>

      {/* Agenter */}
      <Section title="Agenter & signaturer">
        <div className="col-span-full space-y-3">
          {form.agents.map((agent, i) => (
            <div key={i} className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={agent.color}
                  onChange={(e) => {
                    const agents = [...form.agents];
                    agents[i] = { ...agent, color: e.target.value };
                    set('agents', agents);
                  }}
                  className="h-8 w-8 rounded cursor-pointer border border-white/10 bg-transparent"
                  title="Agentfärg"
                />
                <input
                  value={agent.name}
                  onChange={(e) => {
                    const agents = [...form.agents];
                    agents[i] = { ...agent, name: e.target.value };
                    set('agents', agents);
                  }}
                  placeholder="För- och efternamn"
                  className="flex-1 rounded-lg border border-white/10 bg-[#0B0F1A] px-3 py-1.5 text-sm focus:border-[#7C5CFF] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => set('agents', form.agents.filter((_, j) => j !== i))}
                  className="text-slate-500 hover:text-red-400"
                  title="Ta bort agent"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <textarea
                value={agent.signature}
                onChange={(e) => {
                  const agents = [...form.agents];
                  agents[i] = { ...agent, signature: e.target.value };
                  set('agents', agents);
                }}
                placeholder={'Personlig signatur, t.ex.\nBästa hälsningar,\nAnna\nKund AB'}
                rows={3}
                className="w-full rounded-lg border border-white/10 bg-[#0B0F1A] px-3 py-1.5 text-sm focus:border-[#7C5CFF] focus:outline-none font-mono"
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => set('agents', [...form.agents, { name: '', signature: '', color: '#7C5CFF' }])}
            className="flex items-center gap-2 text-sm text-[#9F7BFF] hover:text-[#C9B8FF]"
          >
            <Plus className="h-4 w-4" /> Lägg till agent
          </button>
        </div>
      </Section>

      {/* AI-kategorisering */}
      <Section title="AI-kategorisering av ärenden">
        <Field label="Kategorier (en per rad, avsluta med en övrigt-kategori)" wide>
          <textarea
            value={form.ticketCategories}
            onChange={(e) => set('ticketCategories', e.target.value)}
            rows={6}
            className="w-full rounded-lg border border-white/10 bg-[#0B0F1A] px-3 py-2 text-sm focus:border-[#7C5CFF] focus:outline-none"
          />
        </Field>
      </Section>

      {/* Leverantörsmapp */}
      <Section title="Leverantörsmapp (automatiska mail)">
        <Field label="Fliketikett">
          <Input value={form.vendorLabel} onChange={(v) => set('vendorLabel', v)} placeholder="Billecta" />
        </Field>
        <Field label="Avsändaradresser (kommaseparerade)">
          <Input value={form.vendorSenders} onChange={(v) => set('vendorSenders', v)} placeholder="no-reply@billecta.com" />
        </Field>
      </Section>

      {/* Autosvar */}
      <Section title="Autosvar (mottagningsbekräftelse)">
        <Toggle
          label="Skicka bekräftelse när nytt ärende öppnas"
          checked={form.sendConfirmation}
          onChange={(v) => set('sendConfirmation', v)}
        />
        {form.sendConfirmation && (
          <>
            <Field label="Hälsning">
              <Input value={form.confirmationGreeting} onChange={(v) => set('confirmationGreeting', v)} />
            </Field>
            <Field label="Brödtext (en rad per stycke)" wide>
              <textarea
                value={form.confirmationBody}
                onChange={(e) => set('confirmationBody', e.target.value)}
                rows={4}
                className="w-full rounded-lg border border-white/10 bg-[#0B0F1A] px-3 py-2 text-sm focus:border-[#7C5CFF] focus:outline-none"
              />
            </Field>
            <Field label="Avslut" wide>
              <textarea
                value={form.confirmationSignoff}
                onChange={(e) => set('confirmationSignoff', e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-white/10 bg-[#0B0F1A] px-3 py-2 text-sm focus:border-[#7C5CFF] focus:outline-none"
              />
            </Field>
          </>
        )}
      </Section>

      {/* Fakturering (plattformens abonnemang för kunden) */}
      {billing && (
        <Section title="Fakturering (Successifier-abonnemang)">
          <Field label="Plan">
            <select
              value={billing.plan}
              onChange={(e) => setBilling({ ...billing, plan: e.target.value })}
              className="rounded-lg border border-white/10 bg-[#0B0F1A] px-3 py-2 text-sm focus:border-[#7C5CFF] focus:outline-none"
            >
              <option value="trial">Trial</option>
              <option value="starter">Starter</option>
              <option value="pro">Pro</option>
              <option value="custom">Custom</option>
            </select>
          </Field>
          <Field label="Status">
            <select
              value={billing.billingStatus}
              onChange={(e) => setBilling({ ...billing, billingStatus: e.target.value })}
              className="rounded-lg border border-white/10 bg-[#0B0F1A] px-3 py-2 text-sm focus:border-[#7C5CFF] focus:outline-none"
            >
              <option value="trialing">Provperiod</option>
              <option value="active">Aktiv</option>
              <option value="past_due">Förfallen betalning</option>
              <option value="canceled">Avslutad</option>
              <option value="suspended">Avstängd</option>
            </select>
          </Field>
          <Field label="Provperiod slutar">
            <input
              type="date"
              value={billing.trialEndsAt}
              onChange={(e) => setBilling({ ...billing, trialEndsAt: e.target.value })}
              className="rounded-lg border border-white/10 bg-[#0B0F1A] px-3 py-2 text-sm focus:border-[#7C5CFF] focus:outline-none"
            />
          </Field>
          <div />
          <Field label="Stripe customer-ID">
            <Input
              value={billing.stripeCustomerId}
              onChange={(v) => setBilling({ ...billing, stripeCustomerId: v })}
              placeholder="cus_…"
            />
          </Field>
          <Field label="Stripe subscription-ID">
            <Input
              value={billing.stripeSubscriptionId}
              onChange={(v) => setBilling({ ...billing, stripeSubscriptionId: v })}
              placeholder="sub_…"
            />
          </Field>
        </Section>
      )}

      {/* API */}
      <Section title="API">
        <Field label="API-nyckelprefix">
          <Input value={form.apiKeyPrefix} onChange={(v) => set('apiKeyPrefix', v)} placeholder="acme" />
        </Field>
        <Field label="Publik API-domän (docs)">
          <Input value={form.apiBaseDomain} onChange={(v) => set('apiBaseDomain', v)} placeholder="kund.se" />
        </Field>
      </Section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#7C5CFF] to-[#9F7BFF] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Spara konfiguration
        </button>
        {savedAt && !saving && <span className="text-xs text-emerald-400">Sparat ✓ (aktiv inom ~30 s)</span>}
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-slate-200 mb-3">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function Field({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-1 ${wide ? 'sm:col-span-2' : ''}`}>
      <label className="text-xs text-slate-400">{label}</label>
      {children}
    </div>
  );
}

function Input({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="rounded-lg border border-white/10 bg-[#0B0F1A] px-3 py-2 text-sm focus:border-[#7C5CFF] focus:outline-none"
    />
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="col-span-full flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-white/20 bg-[#0B0F1A] accent-[#7C5CFF]"
      />
      {label}
    </label>
  );
}
