'use client';

import { useState, useEffect } from 'react';
import { Key, Copy, Trash2, Plus, Eye, EyeOff, CheckCircle } from 'lucide-react';
import { product } from '@/lib/products';

interface ApiKey {
  id: string;
  name: string;
  key: string;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

export default function DeveloperPage() {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewKeyModal, setShowNewKeyModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    fetchApiKeys();
  }, []);

  const fetchApiKeys = async () => {
    try {
      const response = await fetch('/api/api-keys');
      if (response.ok) {
        const data = await response.json();
        setApiKeys(data.apiKeys);
      }
    } catch (error) {
      console.error('Error fetching API keys:', error);
    } finally {
      setLoading(false);
    }
  };

  const createApiKey = async () => {
    if (!newKeyName.trim()) return;

    try {
      const response = await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName }),
      });

      if (response.ok) {
        const data = await response.json();
        setNewlyCreatedKey(data.apiKey.key);
        setNewKeyName('');
        fetchApiKeys();
      }
    } catch (error) {
      console.error('Error creating API key:', error);
    }
  };

  const deleteApiKey = async (keyId: string) => {
    if (!confirm('Are you sure you want to delete this API key?')) return;

    try {
      const response = await fetch(`/api/api-keys/${keyId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        fetchApiKeys();
      }
    } catch (error) {
      console.error('Error deleting API key:', error);
    }
  };

  const toggleKeyActive = async (keyId: string, isActive: boolean) => {
    try {
      const response = await fetch(`/api/api-keys/${keyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !isActive }),
      });

      if (response.ok) {
        fetchApiKeys();
      }
    } catch (error) {
      console.error('Error updating API key:', error);
    }
  };

  const copyToClipboard = (text: string, keyId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(keyId);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const toggleKeyVisibility = (keyId: string) => {
    const newVisible = new Set(visibleKeys);
    if (newVisible.has(keyId)) {
      newVisible.delete(keyId);
    } else {
      newVisible.add(keyId);
    }
    setVisibleKeys(newVisible);
  };

  const maskKey = (key: string) => {
    return `${key.substring(0, 12)}${'•'.repeat(20)}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-slate-600 dark:text-slate-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Developer Portal</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1">Manage API keys and access documentation</p>
        </div>
        <button
          onClick={() => setShowNewKeyModal(true)}
          className="px-4 py-2 bg-[#7C5CFF] text-white rounded-md hover:bg-[#6B4FE8] transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Create API Key
        </button>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <a
          href="/developer/docs"
          className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 hover:border-[#7C5CFF] transition-colors"
        >
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">📚 API Documentation</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">Complete API reference and guides</p>
        </a>
        <a
          href="/developer/sdk"
          className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 hover:border-[#7C5CFF] transition-colors"
        >
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">📦 Node.js SDK</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">Install and use our Node.js SDK</p>
        </a>
        <a
          href={`https://github.com/${product.key}/api-examples`}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 hover:border-[#7C5CFF] transition-colors"
        >
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">💻 Code Examples</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">Sample code and integrations</p>
        </a>
      </div>

      {/* API Keys List */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
        <div className="p-6 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">API Keys</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Manage your API keys for programmatic access
          </p>
        </div>

        <div className="divide-y divide-slate-200 dark:divide-slate-700">
          {apiKeys.length === 0 ? (
            <div className="p-8 text-center text-slate-600 dark:text-slate-400">
              No API keys yet. Create one to get started.
            </div>
          ) : (
            apiKeys.map((apiKey) => (
              <div key={apiKey.id} className="p-6 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <Key className="w-5 h-5 text-slate-400" />
                      <h3 className="font-medium text-slate-900 dark:text-slate-100">{apiKey.name}</h3>
                      <span className={`px-2 py-0.5 rounded-full text-xs ${
                        apiKey.isActive
                          ? 'border border-green-300 text-green-700 dark:border-green-700 dark:text-green-300'
                          : 'border border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-300'
                      }`}>
                        {apiKey.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    
                    <div className="flex items-center gap-2 mb-2">
                      <code className="text-sm bg-slate-100 dark:bg-slate-900 px-3 py-1 rounded font-mono text-slate-900 dark:text-slate-100">
                        {visibleKeys.has(apiKey.id) ? apiKey.key : maskKey(apiKey.key)}
                      </code>
                      <button
                        onClick={() => toggleKeyVisibility(apiKey.id)}
                        className="p-1 hover:bg-slate-200 dark:hover:bg-slate-600 rounded"
                        title={visibleKeys.has(apiKey.id) ? 'Hide' : 'Show'}
                      >
                        {visibleKeys.has(apiKey.id) ? (
                          <EyeOff className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                        ) : (
                          <Eye className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                        )}
                      </button>
                      <button
                        onClick={() => copyToClipboard(apiKey.key, apiKey.id)}
                        className="p-1 hover:bg-slate-200 dark:hover:bg-slate-600 rounded"
                        title="Copy"
                      >
                        {copiedKey === apiKey.id ? (
                          <CheckCircle className="w-4 h-4 text-green-600" />
                        ) : (
                          <Copy className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                        )}
                      </button>
                    </div>

                    <div className="flex items-center gap-4 text-xs text-slate-600 dark:text-slate-400">
                      <span>Created {new Date(apiKey.createdAt).toLocaleDateString()}</span>
                      {apiKey.lastUsedAt && (
                        <span>Last used {new Date(apiKey.lastUsedAt).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 ml-4">
                    <button
                      onClick={() => toggleKeyActive(apiKey.id, apiKey.isActive)}
                      className="px-3 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                    >
                      {apiKey.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      onClick={() => deleteApiKey(apiKey.id)}
                      className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Create API Key Modal */}
      {showNewKeyModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">Create New API Key</h3>
            
            {newlyCreatedKey ? (
              <div className="space-y-4">
                <div className="p-4 bg-white dark:bg-slate-800 border border-green-200 dark:border-green-800 rounded">
                  <p className="text-sm text-green-800 dark:text-green-200 mb-2">
                    ✓ API key created successfully! Copy it now - you won't be able to see it again.
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-sm bg-white dark:bg-slate-900 px-3 py-2 rounded font-mono text-slate-900 dark:text-slate-100 break-all">
                      {newlyCreatedKey}
                    </code>
                    <button
                      onClick={() => copyToClipboard(newlyCreatedKey, 'new')}
                      className="p-2 hover:bg-green-100 dark:hover:bg-green-800 rounded"
                    >
                      {copiedKey === 'new' ? (
                        <CheckCircle className="w-5 h-5 text-green-600" />
                      ) : (
                        <Copy className="w-5 h-5 text-green-600" />
                      )}
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setShowNewKeyModal(false);
                    setNewlyCreatedKey(null);
                  }}
                  className="w-full px-4 py-2 bg-[#7C5CFF] text-white rounded-md hover:bg-[#6B4FE8] transition-colors"
                >
                  Done
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Key Name
                  </label>
                  <input
                    type="text"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="e.g., Production API Key"
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                    autoFocus
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setShowNewKeyModal(false);
                      setNewKeyName('');
                    }}
                    className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={createApiKey}
                    disabled={!newKeyName.trim()}
                    className="flex-1 px-4 py-2 bg-[#7C5CFF] text-white rounded-md hover:bg-[#6B4FE8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Create
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
