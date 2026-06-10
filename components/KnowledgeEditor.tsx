'use client';

import { useState, useEffect } from 'react';
import type { KnowledgeBase, KnowledgeCategory } from '@/lib/types';
import Markdown from '@/components/Markdown';

interface KnowledgeEditorProps {
  article: KnowledgeBase | null;
  onSave: (article: Partial<KnowledgeBase>) => void;
  onDelete?: (id: string) => void;
  onCancel: () => void;
}

const inputClass =
  'w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#7C5CFF]';

export default function KnowledgeEditor({ article, onSave, onDelete, onCancel }: KnowledgeEditorProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [isPublic, setIsPublic] = useState(false);
  const [status, setStatus] = useState('draft');
  const [slug, setSlug] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [relatedIds, setRelatedIds] = useState('');
  const [categories, setCategories] = useState<KnowledgeCategory[]>([]);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    fetch('/api/knowledge/categories')
      .then((r) => (r.ok ? r.json() : { categories: [] }))
      .then((d) => setCategories(d.categories || []))
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    if (article) {
      setTitle(article.title);
      setContent(article.content);
      setExcerpt(article.excerpt || '');
      setCategory(article.category || '');
      setTags(article.tags.join(', '));
      setIsActive(article.isActive);
      setIsPublic(article.isPublic);
      setStatus(article.status || 'draft');
      setSlug(article.slug || '');
      setCategoryId(article.categoryId || '');
      setRelatedIds((article.relatedIds || []).join(', '));
    } else {
      setTitle('');
      setContent('');
      setExcerpt('');
      setCategory('');
      setTags('');
      setIsActive(true);
      setIsPublic(false);
      setStatus('draft');
      setSlug('');
      setCategoryId('');
      setRelatedIds('');
    }
  }, [article]);

  const buildPayload = (overrides: Partial<KnowledgeBase> = {}): Partial<KnowledgeBase> => ({
    title,
    content,
    excerpt: excerpt || undefined,
    category: category || undefined,
    tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
    isActive,
    isPublic,
    status,
    slug: slug || undefined,
    categoryId: categoryId || undefined,
    relatedIds: relatedIds.split(',').map((t) => t.trim()).filter(Boolean),
    ...overrides,
  });

  const handleSave = () => onSave(buildPayload());
  const handlePublish = () => {
    setIsPublic(true);
    setStatus('published');
    onSave(buildPayload({ isPublic: true, status: 'published' }));
  };
  const handleUnpublish = () => {
    setIsPublic(false);
    setStatus('draft');
    onSave(buildPayload({ isPublic: false, status: 'draft' }));
  };

  const isAutoLearned = category === 'Lärande från skickade svar';

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm h-full flex flex-col">
      <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
          {article ? 'Redigera artikel' : 'Ny artikel'}
        </h2>
        {article && (
          <span
            className={`text-xs px-2 py-1 rounded-full ${
              article.isPublic
                ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
            }`}
          >
            {article.isPublic ? 'Publik' : 'Intern'} · {article.status}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2 text-slate-900 dark:text-slate-100">Titel</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} placeholder="Artikelns titel…" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2 text-slate-900 dark:text-slate-100">URL-slug</label>
            <input type="text" value={slug} onChange={(e) => setSlug(e.target.value)} className={inputClass} placeholder="genereras-från-titel" />
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Lämnas tom → skapas automatiskt</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2 text-slate-900 dark:text-slate-100">Hjälpcenter-kategori</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputClass}>
              <option value="">— Ingen —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2 text-slate-900 dark:text-slate-100">Sammanfattning (excerpt)</label>
          <input type="text" value={excerpt} onChange={(e) => setExcerpt(e.target.value)} className={inputClass} placeholder="Kort beskrivning för listor och sök…" />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2 text-slate-900 dark:text-slate-100">Intern kategori (för AI)</label>
          <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass} placeholder="t.ex. Fakturering, Leverans…" />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2 text-slate-900 dark:text-slate-100">Taggar</label>
          <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} className={inputClass} placeholder="Kommaseparerade taggar…" />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-slate-900 dark:text-slate-100">Innehåll (Markdown)</label>
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              className="text-xs text-[#7C5CFF] hover:underline"
            >
              {showPreview ? 'Redigera' : 'Förhandsgranska'}
            </button>
          </div>
          {showPreview ? (
            <div className="w-full min-h-[24rem] px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700">
              <Markdown>{content || '_Inget innehåll än._'}</Markdown>
            </div>
          ) : (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className={`${inputClass} h-96 resize-none font-mono text-sm`}
              placeholder="Skriv artikeln i Markdown…"
            />
          )}
        </div>

        <div>
          <label className="block text-sm font-medium mb-2 text-slate-900 dark:text-slate-100">Relaterade artiklar (ID:n)</label>
          <input type="text" value={relatedIds} onChange={(e) => setRelatedIds(e.target.value)} className={inputClass} placeholder="Kommaseparerade artikel-ID:n…" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2 text-slate-900 dark:text-slate-100">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
              <option value="draft">Utkast</option>
              <option value="review">Granskning</option>
              <option value="published">Publicerad</option>
            </select>
          </div>
          <div className="flex flex-col gap-2 justify-end">
            <label className="flex items-center gap-2 text-sm text-slate-900 dark:text-slate-100">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="w-4 h-4 text-[#7C5CFF] rounded" />
              Aktiv (synlig för AI)
            </label>
            <label className={`flex items-center gap-2 text-sm ${isAutoLearned ? 'opacity-50' : 'text-slate-900 dark:text-slate-100'}`}>
              <input
                type="checkbox"
                checked={isPublic}
                disabled={isAutoLearned}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="w-4 h-4 text-[#7C5CFF] rounded"
              />
              Publik (synlig i hjälpcentret)
            </label>
          </div>
        </div>
        {isAutoLearned && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Auto-lärda artiklar kan inte göras publika (innehåller kunddata).
          </p>
        )}
      </div>

      <div className="p-6 border-t border-slate-200 dark:border-slate-700">
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleSave}
            disabled={!title || !content}
            className="flex-1 min-w-[8rem] px-4 py-2 bg-gradient-to-r from-[#7C5CFF] to-[#9F7BFF] text-white rounded-md hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed font-medium shadow-[0_0_15px_rgba(124,92,255,0.4)]"
          >
            Spara
          </button>
          {!isAutoLearned && (article?.isPublic ? (
            <button onClick={handleUnpublish} className="px-4 py-2 border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 rounded-md hover:bg-amber-50 dark:hover:bg-amber-950">
              Avpublicera
            </button>
          ) : (
            <button onClick={handlePublish} disabled={!title || !content} className="px-4 py-2 border border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 rounded-md hover:bg-green-50 dark:hover:bg-green-950 disabled:opacity-50">
              Publicera
            </button>
          ))}
          <button onClick={onCancel} className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-900 dark:text-slate-100">
            Avbryt
          </button>
          {article && onDelete && (
            <button onClick={() => onDelete(article.id)} className="px-4 py-2 border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 rounded-md hover:bg-red-50 dark:hover:bg-red-950">
              Ta bort
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
