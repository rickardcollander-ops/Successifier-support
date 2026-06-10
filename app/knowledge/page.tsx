'use client';

import { useState, useEffect } from 'react';
import KnowledgeList from '@/components/KnowledgeList';
import KnowledgeEditor from '@/components/KnowledgeEditor';
import { t } from '@/lib/i18n';
import type { KnowledgeBase } from '@/lib/types';

export default function KnowledgePage() {
  const [articles, setArticles] = useState<KnowledgeBase[]>([]);
  const [selectedArticle, setSelectedArticle] = useState<KnowledgeBase | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchArticles();
  }, []);

  const fetchArticles = async () => {
    try {
      const response = await fetch('/api/knowledge');
      if (response.ok) {
        const data = await response.json();
        setArticles(data.articles);
      }
    } catch (error) {
      console.error('Error fetching articles:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setIsCreating(true);
    setSelectedArticle(null);
  };

  const handleSave = async (article: Partial<KnowledgeBase>) => {
    try {
      const url = selectedArticle ? `/api/knowledge/${selectedArticle.id}` : '/api/knowledge';
      const method = selectedArticle ? 'PATCH' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(article),
      });

      if (response.ok) {
        const savedArticle = await response.json();
        if (selectedArticle) {
          setArticles(articles.map(a => a.id === savedArticle.id ? savedArticle : a));
        } else {
          setArticles([savedArticle, ...articles]);
        }
        setIsCreating(false);
        setSelectedArticle(null);
      }
    } catch (error) {
      console.error('Error saving article:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('Är du säker på att du vill ta bort denna artikel?'))) return;

    try {
      const response = await fetch(`/api/knowledge/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setArticles(articles.filter(a => a.id !== id));
        if (selectedArticle?.id === id) {
          setSelectedArticle(null);
        }
      }
    } catch (error) {
      console.error('Error deleting article:', error);
    }
  };

  const handleCancel = () => {
    setIsCreating(false);
    setSelectedArticle(null);
  };

  // Quick publish/unpublish straight from the list. Publishing also moves the
  // article to 'published' status so it actually appears in the help center.
  const handleTogglePublic = async (article: KnowledgeBase, makePublic: boolean) => {
    // Optimistic update so the toggle feels instant.
    const optimistic = { ...article, isPublic: makePublic, status: makePublic ? 'published' : article.status };
    setArticles((prev) => prev.map((a) => (a.id === article.id ? optimistic : a)));
    try {
      const response = await fetch(`/api/knowledge/${article.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublic: makePublic, ...(makePublic ? { status: 'published' } : {}) }),
      });
      if (response.ok) {
        const saved = await response.json();
        setArticles((prev) => prev.map((a) => (a.id === saved.id ? saved : a)));
        if (selectedArticle?.id === saved.id) setSelectedArticle(saved);
      } else {
        // Revert on failure.
        setArticles((prev) => prev.map((a) => (a.id === article.id ? article : a)));
      }
    } catch (error) {
      console.error('Error toggling public state:', error);
      setArticles((prev) => prev.map((a) => (a.id === article.id ? article : a)));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-slate-600 dark:text-slate-400">{t('Laddar kunskapsbas…')}</div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-8rem)]">
      <div className="lg:col-span-1 overflow-auto">
        <KnowledgeList
          articles={articles}
          selectedArticle={selectedArticle}
          onSelectArticle={setSelectedArticle}
          onCreateNew={handleCreate}
          onTogglePublic={handleTogglePublic}
        />
      </div>
      <div className="lg:col-span-2 overflow-auto">
        {isCreating || selectedArticle ? (
          <KnowledgeEditor
            article={selectedArticle}
            onSave={handleSave}
            onDelete={selectedArticle ? handleDelete : undefined}
            onCancel={handleCancel}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-slate-500 dark:text-slate-400">
            {t('Välj en artikel eller skapa en ny')}
          </div>
        )}
      </div>
    </div>
  );
}
