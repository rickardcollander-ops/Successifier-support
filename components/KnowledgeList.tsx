import { useMemo, useState } from 'react';
import type { KnowledgeBase } from '@/lib/types';

interface KnowledgeListProps {
  articles: KnowledgeBase[];
  selectedArticle: KnowledgeBase | null;
  onSelectArticle: (article: KnowledgeBase) => void;
  onCreateNew: () => void;
}

type KnowledgeTab = 'manual' | 'learned';

const AUTO_LEARNED_CATEGORY = 'Lärande från skickade svar';

function isAutoLearned(article: KnowledgeBase): boolean {
  return article.category === AUTO_LEARNED_CATEGORY;
}

export default function KnowledgeList({
  articles,
  selectedArticle,
  onSelectArticle,
  onCreateNew,
}: KnowledgeListProps) {
  const [activeTab, setActiveTab] = useState<KnowledgeTab>('manual');

  const { manualArticles, learnedArticles, visibleArticles } = useMemo(() => {
    const manual = articles.filter((a) => !isAutoLearned(a));
    const learned = articles.filter(isAutoLearned);
    return {
      manualArticles: manual,
      learnedArticles: learned,
      visibleArticles: activeTab === 'manual' ? manual : learned,
    };
  }, [articles, activeTab]);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm">
      <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Kunskapsbas</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            {articles.length} artiklar
          </p>
        </div>
        <button
          onClick={onCreateNew}
          className="px-3 py-1 text-sm bg-gradient-to-r from-[#7C5CFF] to-[#9F7BFF] text-white rounded-md hover:brightness-110 shadow-[0_0_15px_rgba(124,92,255,0.4)]"
        >
          + Ny
        </button>
      </div>
      <div className="flex border-b border-slate-200 dark:border-slate-700" role="tablist">
        <button
          role="tab"
          aria-selected={activeTab === 'manual'}
          onClick={() => setActiveTab('manual')}
          className={`flex-1 px-4 py-2.5 text-sm font-medium transition-all ${
            activeTab === 'manual'
              ? 'text-[#7C5CFF] border-b-2 border-[#7C5CFF] bg-[#7C5CFF]/5'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
          title="Manuellt skapade artiklar från hemsida/FAQ"
        >
          Manuella
          <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
            activeTab === 'manual'
              ? 'bg-[#7C5CFF] text-white'
              : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
          }`}>
            {manualArticles.length}
          </span>
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'learned'}
          onClick={() => setActiveTab('learned')}
          className={`flex-1 px-4 py-2.5 text-sm font-medium transition-all ${
            activeTab === 'learned'
              ? 'text-[#7C5CFF] border-b-2 border-[#7C5CFF] bg-[#7C5CFF]/5'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
          title="Automatiskt lärda från skickade mail"
        >
          Lärda från mail
          <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
            activeTab === 'learned'
              ? 'bg-[#7C5CFF] text-white'
              : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
          }`}>
            {learnedArticles.length}
          </span>
        </button>
      </div>
      <div className="divide-y divide-slate-200 dark:divide-slate-700 max-h-[calc(100vh-14rem)] overflow-y-auto">
        {visibleArticles.length === 0 ? (
          <div className="p-8 text-center text-slate-500 dark:text-slate-400">
            {activeTab === 'manual'
              ? 'Inga manuella artiklar ännu. Skapa din första!'
              : 'Inga automatiskt lärda artiklar ännu. De skapas när du skickar svar.'}
          </div>
        ) : (
          visibleArticles.map((article) => (
            <button
              key={article.id}
              onClick={() => onSelectArticle(article)}
              className={`w-full text-left p-4 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors ${
                selectedArticle?.id === article.id ? 'bg-slate-50 dark:bg-slate-700' : ''
              }`}
            >
              <h3 className="font-medium text-sm text-slate-900 dark:text-slate-100 mb-2">{article.title}</h3>
              {article.category && (
                <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">{article.category}</p>
              )}
              {article.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {article.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="text-xs px-2 py-0.5 rounded border border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300">
                      {tag}
                    </span>
                  ))}
                  {article.tags.length > 3 && (
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      +{article.tags.length - 3}
                    </span>
                  )}
                </div>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
