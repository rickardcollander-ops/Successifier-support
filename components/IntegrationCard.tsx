'use client';

import { useState, useEffect } from 'react';
import type { Integration } from '@/lib/types';

interface IntegrationField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'email';
  placeholder: string;
}

interface IntegrationCardProps {
  type: string;
  name: string;
  description: string;
  integration?: Integration;
  fields: IntegrationField[];
  onSave: (type: string, credentials: Record<string, string>) => Promise<{ ok: boolean; message?: string }>;
  onToggle: (id: string, isActive: boolean) => void;
  onTestConnection?: (integration: Integration) => Promise<{ ok: boolean; message: string } | null>;
}

export default function IntegrationCard({
  type,
  name,
  description,
  integration,
  fields,
  onSave,
  onToggle,
  onTestConnection,
}: IntegrationCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // The server only ever returns masked credentials, so the edit form always
  // starts empty — fields left blank keep their stored value on save.
  useEffect(() => {
    const initial: Record<string, string> = {};
    fields.forEach(field => {
      initial[field.key] = '';
    });
    setCredentials(initial);
  }, [integration, fields]);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    const result = await onSave(type, credentials);
    setIsSaving(false);
    if (result.ok) {
      setIsEditing(false);
    } else {
      setSaveError(result.message || 'Failed to save integration settings');
    }
  };

  const handleToggle = () => {
    if (integration) {
      onToggle(integration.id, !integration.isActive);
    }
  };

  const handleTestConnection = async () => {
    if (!integration || !onTestConnection) return;

    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await onTestConnection(integration);
      if (result) {
        setTestResult(result);
      }
    } finally {
      setIsTesting(false);
    }
  };

  const isConfigured = integration && Object.keys(integration.credentials).length > 0;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm p-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{name}</h3>
            {isConfigured && (
              <span className={`text-xs px-2 py-1 rounded-full ${
                integration?.isActive
                  ? 'border border-green-300 text-green-800 dark:border-green-700 dark:text-green-200'
                  : 'border border-slate-300 text-slate-800 dark:border-slate-600 dark:text-slate-200'
              }`}>
                {integration?.isActive ? 'Active' : 'Inactive'}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400">{description}</p>
        </div>
        {isConfigured && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={integration?.isActive}
              onChange={handleToggle}
              className="w-4 h-4 text-[#7C5CFF] rounded focus:ring-2 focus:ring-[#7C5CFF]"
            />
            <span className="text-sm text-slate-900 dark:text-slate-100">Enable</span>
          </label>
        )}
      </div>

      {isEditing || !isConfigured ? (
        <div className="space-y-4 mt-4">
          {isConfigured && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Leave a field empty to keep its saved value.
            </p>
          )}
          {fields.map((field) => (
            <div key={field.key}>
              <label className="block text-sm font-medium mb-1 text-slate-900 dark:text-slate-100">{field.label}</label>
              <input
                type={field.type}
                value={credentials[field.key] || ''}
                onChange={(e) => setCredentials({ ...credentials, [field.key]: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#7C5CFF]"
                placeholder={isConfigured ? '•••••••• (saved)' : field.placeholder}
              />
            </div>
          ))}
          <div className="flex gap-3 mt-4">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 bg-gradient-to-r from-[#7C5CFF] to-[#9F7BFF] text-white rounded-md hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_15px_rgba(124,92,255,0.4)]"
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
            {isConfigured && (
              <button
                onClick={() => setIsEditing(false)}
                className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-900 dark:text-slate-100"
              >
                Cancel
              </button>
            )}
          </div>
          {saveError && (
            <p className="text-xs text-red-600 dark:text-red-400">{saveError}</p>
          )}
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={() => setIsEditing(true)}
            className="text-sm text-[#7C5CFF] hover:text-[#9F7BFF] hover:underline"
          >
            Edit credentials
          </button>
          {integration && onTestConnection && (
            <button
              onClick={handleTestConnection}
              disabled={isTesting}
              className="text-sm px-3 py-1 rounded-md border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 disabled:opacity-60"
            >
              {isTesting ? 'Testing...' : 'Test connection'}
            </button>
          )}
          {testResult && (
            <span
              className={`text-xs px-2 py-1 rounded-full ${
                testResult.ok
                  ? 'border border-green-300 text-green-800 dark:border-green-700 dark:text-green-200'
                  : 'border border-red-300 text-red-800 dark:border-red-700 dark:text-red-200'
              }`}
            >
              {testResult.message}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
