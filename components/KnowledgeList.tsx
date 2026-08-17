import { useEffect, useMemo, useState } from 'react';
import type { KnowledgeBase } from '@/lib/types';
import { t } from '@/lib/i18n';

interface KnowledgeListProps {
  articles: KnowledgeBase[];
  selectedArticle: KnowledgeBase | null;
  onSelectArticle: (article: KnowledgeBase) => void;
  onCreateNew: () => void;
  onTogglePublic?: (article: KnowledgeBase, makePublic: boolean) => void;
}

type KnowledgeTab = 'manual' | 'learned' | 'review';
type VisibilityFilter = 'all' | 'public' | 'internal';

const AUTO_LEARNED_CATEGORY = 'Lärande från skickade svar';

function isAutoLearned(article: KnowledgeBase): boolean {
  return article.category === AUTO_LEARNED_CATEGORY;
}

export default function KnowledgeList({
  articles,
  selectedArticle,
  onSelectArticle,
  onCreateNew,
  onTogglePublic,
}: KnowledgeListProps) {
  const [activeTab, setActiveTab] = useState<KnowledgeTab>('manual');
  const [visibility, setVisibility] = useState<VisibilityFilter>('all');
  // Badge on the knowledge-cards link: contradictions waiting for someone to
  // pick a version. Best-effort — a failed count just hides the badge.
  const [openConflicts, setOpenConflicts] = useState(0);

  useEffect(() => {
    fetch('/api/knowledge/conflicts?status=open')
      .then(r => (r.ok ? r.json() : null))
      .then(data => setOpenConflicts(data?.conflicts?.length ?? 0))
      .catch(() => setOpenConflicts(0));
  }, []);

  const { manualArticles, learnedArticles, reviewArticles, visibleArticles } = useMemo(() => {
    const manual = articles.filter((a) => !isAutoLearned(a));
    const learned = articles.filter(isAutoLearned);
    const review = articles.filter((a) => a.status === 'review');
    let visible = activeTab === 'manual' ? manual : activeTab === 'learned' ? learned : review;
    if (visibility === 'public') visible = visible.filter((a) => a.isPublic);
    else if (visibility === 'internal') visible = visible.filter((a) => !a.isPublic);
    return { manualArticles: manual, learnedArticles: learned, reviewArticles: review, visibleArticles: visible };
  }, [articles, activeTab, visibility]);

  const tabClass = (tab: KnowledgeTab) =>
    `flex-1 px-4 py-2.5 text-sm font-medium transition-all ${
      activeTab === tab
        ? 'text-[#7C5CFF] border-b-2 border-[#7C5CFF] bg-[#7C5CFF]/5'
        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
    }`;

  const countClass = (tab: KnowledgeTab) =>
    `ml-2 px-2 py-0.5 rounded-full text-xs ${
      activeTab === tab ? 'bg-[#7C5CFF] text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
    }`;

  const filterBtn = (value: VisibilityFilter, label: string) => (
    <button
      onClick={() => setVisibility(value)}
      className={`px-2.5 py-1 text-xs rounded-md ${
        visibility === value
          ? 'bg-[#7C5CFF] text-white'
          : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm">
      <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Kunskapsbas</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{articles.length} artiklar</p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/knowledge/cards" className="px-3 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center gap-1.5" title="Kunskapskort och motsägelser att granska">
            Kunskapskort
            {openConflicts > 0 && (
              <span className="px-1.5 py-0.5 text-xs rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                {openConflicts}
              </span>
            )}
          </a>
          <a href="/knowledge/design" className="px-3 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300" title="Hjälpcentrets design">
            Design
          </a>
          <a href="/knowledge/analytics" className="px-3 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300" title="Hjälpcenter-statistik">
            Statistik
          </a>
          <a href="/help" target="_blank" rel="noopener noreferrer" className="px-3 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300" title="Öppna det publika hjälpcentret">
            Hjälpcenter ↗
          </a>
          <button onClick={onCreateNew} className="px-3 py-1 text-sm bg-gradient-to-r from-[#7C5CFF] to-[#9F7BFF] text-white rounded-md hover:brightness-110 shadow-[0_0_15px_rgba(124,92,255,0.4)]">
            + Ny
          </button>
        </div>
      </div>

      <div className="flex border-b border-slate-200 dark:border-slate-700" role="tablist">
        <button role="tab" aria-selected={activeTab === 'manual'} onClick={() => setActiveTab('manual')} className={tabClass('manual')} title={t('Manuellt skapade artiklar från hemsida/FAQ')}>
          Manuella<span className={countClass('manual')}>{manualArticles.length}</span>
        </button>
        <button role="tab" aria-selected={activeTab === 'learned'} onClick={() => setActiveTab('learned')} className={tabClass('learned')} title={t('Automatiskt lärda från skickade mail')}>
          Lärda från mail<span className={countClass('learned')}>{learnedArticles.length}</span>
        </button>
        <button role="tab" aria-selected={activeTab === 'review'} onClick={() => setActiveTab('review')} className={tabClass('review')} title={t('Artiklar som väntar på granskning innan publicering')}>
          Granskning<span className={countClass('review')}>{reviewArticles.length}</span>
        </button>
      </div>

      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-200 dark:border-slate-700">
        <span className="text-xs text-slate-500 dark:text-slate-400 mr-1">Visa:</span>
        {filterBtn('all', 'Alla')}
        {filterBtn('public', 'Publika')}
        {filterBtn('internal', 'Interna')}
      </div>

      <div className="divide-y divide-slate-200 dark:divide-slate-700 max-h-[calc(100vh-17rem)] overflow-y-auto">
        {visibleArticles.length === 0 ? (
          <div className="p-8 text-center text-slate-500 dark:text-slate-400">
            {activeTab === 'manual'
              ? 'Inga manuella artiklar ännu. Skapa din första!'
              : activeTab === 'learned'
              ? 'Inga automatiskt lärda artiklar ännu. De skapas när du skickar svar.'
              : 'Inga artiklar väntar på granskning.'}
          </div>
        ) : (
          visibleArticles.map((article) => {
            const locked = isAutoLearned(article);
            return (
              <div
                key={article.id}
                className={`flex items-start gap-2 p-4 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors ${
                  selectedArticle?.id === article.id ? 'bg-slate-50 dark:bg-slate-700' : ''
                }`}
              >
                <button onClick={() => onSelectArticle(article)} className="flex-1 text-left min-w-0">
                  <h3 className="font-medium text-sm text-slate-900 dark:text-slate-100 mb-2 flex items-center gap-2">
                    {article.isPublic && <span className="inline-block w-2 h-2 rounded-full bg-green-500 shrink-0" title="Publik i hjälpcentret" />}
                    <span className="truncate">{article.title}</span>
                  </h3>
                  {article.category && <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">{article.category}</p>}
                  {article.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {article.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="text-xs px-2 py-0.5 rounded border border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300">{tag}</span>
                      ))}
                      {article.tags.length > 3 && <span className="text-xs text-slate-500 dark:text-slate-400">+{article.tags.length - 3}</span>}
                    </div>
                  )}
                </button>

                {onTogglePublic && (
                  <button
                    onClick={() => !locked && onTogglePublic(article, !article.isPublic)}
                    disabled={locked}
                    title={locked ? 'Auto-lärda artiklar kan inte publiceras (innehåller kunddata)' : article.isPublic ? 'Publik – klicka för att avpublicera' : 'Intern – klicka för att publicera'}
                    aria-pressed={article.isPublic}
                    className={`shrink-0 relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      locked ? 'cursor-not-allowed opacity-40 bg-slate-300 dark:bg-slate-600' : article.isPublic ? 'bg-green-500' : 'bg-slate-300 dark:bg-slate-600'
                    }`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${article.isPublic ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
