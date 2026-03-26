import type { KnowledgeBase } from '@/lib/types';

interface KnowledgeListProps {
  articles: KnowledgeBase[];
  selectedArticle: KnowledgeBase | null;
  onSelectArticle: (article: KnowledgeBase) => void;
  onCreateNew: () => void;
}

export default function KnowledgeList({
  articles,
  selectedArticle,
  onSelectArticle,
  onCreateNew,
}: KnowledgeListProps) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm">
      <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Knowledge Base</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            {articles.length} articles
          </p>
        </div>
        <button
          onClick={onCreateNew}
          className="px-3 py-1 text-sm bg-gradient-to-r from-[#7C5CFF] to-[#9F7BFF] text-white rounded-md hover:brightness-110 shadow-[0_0_15px_rgba(124,92,255,0.4)]"
        >
          + New
        </button>
      </div>
      <div className="divide-y divide-slate-200 dark:divide-slate-700 max-h-[calc(100vh-12rem)] overflow-y-auto">
        {articles.length === 0 ? (
          <div className="p-8 text-center text-slate-500 dark:text-slate-400">
            No articles yet. Create your first one!
          </div>
        ) : (
          articles.map((article) => (
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
