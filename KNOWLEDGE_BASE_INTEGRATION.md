# Kunskapsbas & publikt hjälpcenter

Kunskapsbasen driver både AI-svaren (internt) och ett **publikt hjälpcenter**
som kan integreras med hemsidan. All publik åtkomst sker via ett läs-endast
API som bara exponerar **publicerade, publika** artiklar – aldrig kunddata.

## Synlighet

En artikel har två oberoende flaggor:

| Fält       | Styr                                   |
|------------|----------------------------------------|
| `isActive` | Om **AI:n** får använda artikeln        |
| `isPublic` | Om artikeln visas i **hjälpcentret**    |
| `status`   | Redaktionellt flöde: `draft` → `review` → `published` |

En artikel syns publikt endast när `isPublic = true` **och** `status = 'published'`.
Auto-lärda artiklar (kategori `Lärande från skickade svar`) kan aldrig bli
publika eftersom de innehåller kunduppgifter.

## Tre sätt att integrera

### 1. Färdigt hjälpcenter (server-renderat)
Länka hemsidan till `/help`:
- `/help` – start med sök + kategorier
- `/help/c/<kategori>` – kategorisida
- `/help/<slug>` – artikel (Markdown, "Var detta till hjälp?")
- `/help/sitemap.xml` – för indexering

### 2. Inbäddningsbar widget
Klistra in på valfri sida:

```html
<script src="https://DIN-APP-DOMÄN/kb-widget.js"
        data-kb-base="https://DIN-APP-DOMÄN"></script>
```

En flytande "Hjälp"-knapp med livesök läggs till.

### 3. Publikt JSON-API (egen rendering)
Hämta innehåll och rendera i hemsidans egen design. Inget API-nyckel krävs.
CORS tillåts för produktens domäner.

| Metod & väg                                   | Beskrivning                         |
|-----------------------------------------------|-------------------------------------|
| `GET /api/public/kb/categories`               | Publika kategorier + artikelantal   |
| `GET /api/public/kb/articles?category=&page=` | Lista publicerade artiklar          |
| `GET /api/public/kb/articles/<slug>`          | En artikel (full Markdown + related)|
| `GET /api/public/kb/search?q=`                | Fulltextsök (svensk språkconfig)    |
| `POST /api/public/kb/articles/<slug>/feedback`| `{ "helpful": true }`               |

Exempel:

```bash
curl "https://DIN-APP-DOMÄN/api/public/kb/search?q=uppsägning"
```

## Analys

Visningar, sökningar (inkl. sökningar utan träff) och hjälpsam-röster loggas i
`KnowledgeEvent` och aggregeras i `GET /api/knowledge/analytics` (kräver
inloggning). Sökningar utan träff visar innehållsluckor att fylla.
