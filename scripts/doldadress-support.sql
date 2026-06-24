-- Publicera FAQ-innehållet från doldadress.se/support i kunskapsbasen.
-- Idempotent: matchar på (tenantId, slug). Säker att köra om.
-- Tenant: doldadress.  searchVector fylls automatiskt (GENERATED).
-- Återanvänder befintliga kategorier (samma slugs som vanliga-fragor-seed).
BEGIN;

-- 1) Publika kategorier (befintliga – uppdateras bara, inga nya skapas)
WITH t AS (SELECT id FROM "Tenant" WHERE id = 'doldadress' OR subdomain = 'doldadress' LIMIT 1)
INSERT INTO "KnowledgeCategory" ("id","tenantId","name","slug","sortOrder","isPublic","createdAt","updatedAt")
SELECT gen_random_uuid()::text, t.id, v.name, v.slug, v."sortOrder", true, now(), now()
FROM t CROSS JOIN (VALUES
  ('Jag vill bli kund', 'jag-vill-bli-kund', 0),
  ('Ny kund', 'ny-kund', 1),
  ('Avindexering', 'avindexering', 2),
  ('Upplysningar', 'upplysningar', 4),
  ('Adresslarm', 'adresslarm', 5)
) AS v(name, slug, "sortOrder")
ON CONFLICT ("tenantId","slug") DO UPDATE
  SET "name" = EXCLUDED."name", "sortOrder" = EXCLUDED."sortOrder", "isPublic" = true, "updatedAt" = now();

-- 2) Artiklar (AI-aktiva + publicerade i hjälpcentret)
WITH t AS (SELECT id FROM "Tenant" WHERE id = 'doldadress' OR subdomain = 'doldadress' LIMIT 1)
INSERT INTO "KnowledgeBase" ("id","tenantId","title","content","excerpt","category","categoryId","tags","slug","isActive","isPublic","status","sortOrder","relatedIds","viewCount","createdAt","updatedAt")
SELECT gen_random_uuid()::text, t.id, v.title, v.content, v.excerpt, v.category,
       (SELECT c.id FROM "KnowledgeCategory" c WHERE c."tenantId" = t.id AND c.slug = v."categorySlug"),
       ARRAY['Support', v.category]::text[], v.slug, true, true, 'published', v."sortOrder",
       ARRAY[]::text[], 0, now(), now()
FROM t CROSS JOIN (VALUES
  ('vad-innebar-det-att-vara-kund-hos-doldadress', 'Vad innebär det att vara kund hos DoldAdress?', 'Vad roligt att du funderar på att bli kund hos oss! Som kund hos DoldAdress får du hjälp att skydda din integritet och minska din synlighet på nätet.

Vi avindexerar länkar på Google som innehåller information om dig som du inte vill ska vara synlig i sökresultatet, exempelvis länkar från upplysningssajter, Flashback, Lexbase, nyhetsartiklar eller bilder på Google. Så länge innehållet inte omfattas av allmänintresse kan vi hjälpa dig att ta bort länkarna från Googles sökresultat.

Vi hjälper dig även att bli borttagen från flera av Sveriges största upplysningssajter, såsom Mr Koll, Ratsit, Hitta, Birthday, Merinfo med flera. Dessutom övervakar vi din synlighet och varnar dig om dina uppgifter publiceras igen.

I tjänsten ingår också adresslarm som bevakar din folkbokföringsadress och meddelar dig direkt om någon obehörig försöker skriva sig där.

För ökad trygghet ingår även hackskydd. Vi övervakar kontinuerligt om konton kopplade till din e-postadress förekommer i dataläckor och skickar en varning så att du snabbt kan agera vid behov.

Allt samlas på Mina sidor, där du enkelt kan följa dina ärenden, bevakningar och varningar.', 'Vad roligt att du funderar på att bli kund hos oss! Som kund hos DoldAdress får du hjälp att skydda din integritet och minska din synlighet på nätet. Vi…', 'Jag vill bli kund', 'jag-vill-bli-kund', 0),
  ('hur-kommer-jag-igang-som-kund', 'Hur kommer jag igång som kund?', 'Att komma igång är enkelt! Klicka på knappen ”Kom igång” längst upp till höger på vår webbplats och välj det paket som passar dina behov. Därefter registrerar du dig och får omedelbar tillgång till våra tjänster.

När ditt konto är aktiverat kan du börja skydda din integritet online direkt, följa dina ärenden på Mina sidor och ta del av våra bevaknings- och säkerhetstjänster.

Välkommen till DoldAdress!', 'Att komma igång är enkelt! Klicka på knappen ”Kom igång” längst upp till höger på vår webbplats och välj det paket som passar dina behov. Därefter…', 'Jag vill bli kund', 'jag-vill-bli-kund', 1),
  ('behover-jag-teckna-ett-abonnemang-for-att-anvanda-doldadress', 'Behöver jag teckna ett abonnemang för att använda DoldAdress?', 'Ja, DoldAdress är en abonnemangstjänst. Du väljer själv det abonnemang och betalningsalternativ som passar dig bäst när du registrerar dig.

Som kund får du tillgång till våra tjänster och ett löpande skydd för din integritet online.', 'Ja, DoldAdress är en abonnemangstjänst. Du väljer själv det abonnemang och betalningsalternativ som passar dig bäst när du registrerar dig. Som kund får…', 'Jag vill bli kund', 'jag-vill-bli-kund', 2),
  ('vem-kan-bli-kund-hos-doldadress', 'Vem kan bli kund hos DoldAdress?', 'För att bli kund hos oss behöver du:
• Vara minst 18 år gammal
• Ha tillgång till BankID
• Vara folkbokförd i Sverige

Våra tjänster är utformade för personer som finns registrerade i det svenska folkbokföringsregistret. Därför kan vi tyvärr inte erbjuda tjänsten till personer som har sekretessmarkerad identitet eller andra former av skyddade personuppgifter.', 'För att bli kund hos oss behöver du: • Vara minst 18 år gammal • Ha tillgång till BankID • Vara folkbokförd i Sverige Våra tjänster är utformade för…', 'Jag vill bli kund', 'jag-vill-bli-kund', 3),
  ('vad-hander-efter-jag-har-kopt', 'Vad händer efter jag har köpt?', 'När du gjort ditt köp hos oss får du en bekräftelse via e-post med en aktiveringslänk. Du måste klicka på länken och skapa ditt konto. Efter det får du tillgång till “Mina Sidor”. I samband med aktivering kommer vi automatiskt att ta bort skadliga sökresultat om dig från upplysnings-sajter på Google.', 'När du gjort ditt köp hos oss får du en bekräftelse via e-post med en aktiveringslänk. Du måste klicka på länken och skapa ditt konto. Efter det får du…', 'Ny kund', 'ny-kund', 4),
  ('hur-lang-tid-tar-det-innan-jag-forsvinner-pa-google', 'Hur lång tid tar det innan jag försvinner på Google?', 'Den genomsnittliga behandlingstiden är 13 dagar, men i vissa fall kan det gå så snabbt som 4 dagar. Vissa länkar kräver att vi juridiskt bevisar för Google att de bryter mot EU:s lagstiftning. Om detta blir nödvändigt kan processen förlängas till flera månader, eftersom Google har upp till 6 månader på sig att svara. Många bestridanden nekas initialt, men en betydande andel lyckas vid överklagan. För närvarande tas 50 % av de länkar som först fått avslag bort.', 'Den genomsnittliga behandlingstiden är 13 dagar, men i vissa fall kan det gå så snabbt som 4 dagar. Vissa länkar kräver att vi juridiskt bevisar för…', 'Avindexering', 'avindexering', 5),
  ('kan-ni-avindexera-bilder', 'Kan ni avindexera bilder?', 'Ja, vi kan avindexera bilder från Google. Om du vill avindexera en bild kan du skicka in länken till bilden under fliken "Avindexering" genom ditt inlogg.', 'Ja, vi kan avindexera bilder från Google. Om du vill avindexera en bild kan du skicka in länken till bilden under fliken "Avindexering" genom ditt inlogg.', 'Avindexering', 'avindexering', 6),
  ('meddelar-ni-mig-om-en-upplysnings-sajt-aterpublicerar-mina-uppgifter', 'Meddelar ni mig om en upplysnings-sajt återpublicerar mina uppgifter?', 'Ja, om dina uppgifter blir synliga igen får du ett mail från oss, så att du själv slipper att hålla koll på din status.', 'Ja, om dina uppgifter blir synliga igen får du ett mail från oss, så att du själv slipper att hålla koll på din status.', 'Upplysningar', 'upplysningar', 7),
  ('hur-hjalper-ni-mig-om-nagon-skriver-in-sig-pa-min-adress', 'Hur hjälper ni mig om någon skriver in sig på min adress?', 'Vi varnar dig direkt och ger dig instruktioner på hur du ska gå tillväga för att åtgärda problemet med Skatteverket.', 'Vi varnar dig direkt och ger dig instruktioner på hur du ska gå tillväga för att åtgärda problemet med Skatteverket.', 'Adresslarm', 'adresslarm', 8)
) AS v(slug, title, content, excerpt, category, "categorySlug", "sortOrder")
ON CONFLICT ("tenantId","slug") DO UPDATE
  SET "title" = EXCLUDED."title", "content" = EXCLUDED."content", "excerpt" = EXCLUDED."excerpt",
      "category" = EXCLUDED."category", "categoryId" = EXCLUDED."categoryId", "tags" = EXCLUDED."tags",
      "isActive" = true, "isPublic" = true, "status" = 'published', "sortOrder" = EXCLUDED."sortOrder",
      "updatedAt" = now();

COMMIT;
