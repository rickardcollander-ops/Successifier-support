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

## Design

Hjälpcentrets utseende ställs in under **Kunskapsbas → Design** (`/knowledge/design`)
och sparas per tenant (`HelpCenterConfig`). Du kan välja accentfärg, tema
(ljust/mörkt/auto), logga, rubrik, introtext, layout (rutnät/lista) och om
sökrutan ska visas. En live-förhandsvisning visar resultatet innan du sparar.
Sidorna under `/help` läser konfigurationen och temats färger styrs av
CSS-variabler så valt tema alltid gäller – oberoende av appens interna mörka läge.

## Publik eller intern

Vilka artiklar som syns publikt styrs antingen i editorn (Publicera/Avpublicera)
eller med snabb-toggeln direkt i artikellistan. Filtret **Alla / Publika /
Interna** överst i listan visar nuläget. Auto-lärda artiklar kan aldrig
publiceras.

## Analys

Visningar, sökningar (inkl. sökningar utan träff) och hjälpsam-röster loggas i
`KnowledgeEvent` och aggregeras i `GET /api/knowledge/analytics` (kräver
inloggning). Sökningar utan träff visar innehållsluckor att fylla.
