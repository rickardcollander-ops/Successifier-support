const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const TARGET_TENANT = 'doldadress';

const conciseArticles = {
  'Supportmall: Kund synlig fortfarande': `Kundfråga: "Jag är fortfarande synlig".

Kort svar:
1) Om kunden är synlig på upplysningssajter: hänvisa till Mina sidor > Upplysningar och respektive guide.
2) Om kunden är synlig i Google: hänvisa till Mina sidor > Avindexering.
3) Be kunden skicka in alla relevanta länkar (inkl. egna Google-träffar).
4) Informera om normal handläggningstid: upp till 8 veckor (ofta snabbare).

Malltext:
"Tack för att du hör av dig 💛
Om du är synlig på upplysningssajter, följ guiderna under Upplysningar på Mina sidor.
Om du är synlig i Google, skicka in länkarna under Avindexering så hanterar vi dem åt dig.
När länkarna är inskickade behandlas de normalt inom 8 veckor, och du kan följa status i realtid på samma flik."`,

  'Supportmall: Upplysningar': `Ämne: Upplysningar (Mrkoll, Upplysning.se m.fl.)

Nyckelpunkter:
- Mrkoll kan skicka autosvar; borttagning kan ta upp till ca 2 månader.
- Upplysning.se kan ha långa handläggningstider.
- Kunden kan följa status i Mina sidor > Upplysningar.
- Om guidesteg är gjorda behövs ofta bara väntan.

Malltext:
"Tack för ditt mejl 💛
Vi förstår att väntan är frustrerande. Du hittar status och eventuella återstående steg under Upplysningar på Mina sidor.
För vissa sajter (t.ex. Mrkoll/Upplysning.se) kan handläggningen ta längre tid hos dem, även om begäran är korrekt inskickad."`,

  'Supportmall: Ångerrätt och retur': `Ämne: Ångerrätt/retur

Regel:
- 14 dagars ångerrätt från köptillfället.

Mall vid godkänd ångerrätt:
"Tack för att du hör av dig. Din retur är registrerad, fakturan krediteras och kontot avslutas." 

Mall vid för sen ånger:
"Ångerrätten gäller i 14 dagar från köpdatum. Din period har passerat, men du kan säga upp abonnemanget inför nästa förnyelse under Mina sidor > Prenumeration."`,

  'Supportmall: Vill bli kund': `Ämne: Prospektfråga "hur fungerar tjänsten?"

Kärnbudskap:
- Doldadress är en prenumerationstjänst för digital integritet.
- Kunden hanterar borttagning via guider i Upplysningar.
- Google-länkar hanteras via Avindexering (kunden väljer länkar, teamet processar).
- Ärenden följs på Mina sidor.
- Hänvisa till prislista och FAQ.

Malltext:
"Tack för ditt intresse! Vi hjälper dig att minska synligheten av privata uppgifter online.
Du följer guider för upplysningssajter i Mina sidor och skickar in Google-länkar under Avindexering, så sköter vi bearbetningen.
Se abonnemang här: https://www.doldadress.se/#pricing"`,

  'Supportmall: Uppsägning': `Ämne: Uppsägning

Instruktion:
Mina sidor > Prenumeration > Information > "Ändra din prenumeration".

Malltext:
"Du kan säga upp abonnemanget till nästa förnyelseperiod under Mina sidor > Prenumeration.
Om du vill kan vi hjälpa dig manuellt med uppsägningen." 

Vid fråga om faktura efter uppsägning:
"Uppsägningen gäller vid periodens slut. Redan skapade fakturor avser aktiv period och behöver betalas enligt villkor."`,

  'Supportmall: Tekniskt fel': `Ämne: Registrering fungerar inte

Vanliga orsaker:
- ogiltigt personnummer
- folkbokföringsuppgifter matchar inte
- ålderskrav
- sekretessmarkering

Malltext:
"Vi har testat registreringen men får samma fel. Det kan bero på personnummer/adressuppgifter/behörighet.
Om registrering inte kan slutföras ser vi till att du inte debiteras för en tjänst du inte kan använda."`,

  'Supportmall: Avindexering': `Ämne: Avindexering (Google)

Nyckelpunkter:
- Fullmakt krävs för att teamet ska kunna agera hos Google.
- Nekad länk = Google har avslagit (t.ex. ej personuppgift/allmänt intresse).
- Kunden kan skicka in länk på nytt, utan garanti för annat utfall.
- Status följs i realtid under Avindexering.

Malltext:
"Tack för att du hör av dig 🧡
Skicka in alla aktuella länkar via Avindexering på Mina sidor.
Om en länk nekats av Google kan vi försöka igen, men vi kan inte garantera godkännande vid omprövning."`,

  'Supportmall: ID-skydd': `Ämne: ID-skydd och prisfrågor

Malltext:
"Din faktura är högre eftersom ID-skydd lagts till. Om vi kommit överens om kostnadsfri ID-skyddsrabatt, bekräfta att den är aktiv framåt.
Vid behov: be kunden återkomma efter betalning så återbetalar vi mellanskillnaden enligt beslut."`,

  'Supportmall: Reklamation': `Ämne: Reklamation/missnöje

Princip:
- Bekräfta kundens upplevelse.
- Förklara tydligt vad som ingår i tjänsten och vad kunden behöver initiera själv.
- Beskriv vad som redan gjorts (t.ex. antal hanterade länkar).
- Ge tydligt nästa steg eller avslut.

Malltext:
"Tack för din återkoppling. Vi förstår frustrationen.
Vi hanterar bearbetning av inskickade länkar och automatisk bevakning, medan vissa borttagningar kräver åtgärder via externa sajters egna processer.
Om du vill går vi gärna igenom ditt ärende rad för rad och föreslår nästa steg."`,

  'Supportmall: Mina sidor': `Ämne: Mina sidor (adress, fullmakt, översikt, dataläcka)

Malltext:
"Adressuppgifter uppdateras normalt automatiskt från folkbokföringsdata.
Om något ser fel ut kan vi kontrollera och uppdatera manuellt.
För avindexering behöver vi fullmakt för att agera hos Google. Du kan alltid återkalla fullmakten.
Vid dataläcka rekommenderar vi omedelbart lösenordsbyte och tvåstegsverifiering."`,

  'Supportmall: Övrigt': `Ämne: Övriga frågor (biluppgifter, bolagsinfo m.m.)

Malltext:
"Vissa uppgifter kommer från offentliga register och kan därför vara svåra eller omöjliga att ta bort helt.
Vi kan hjälpa med avindexering av vissa länkar i Google, men inte garantera borttagning av all information.
Vid uteblivet svar från extern aktör kan kunden skicka formell GDPR-begäran och vid behov kontakta IMY."`,

  'Supportmall: Fakturafrågor': `Ämne: Betalsätt/fakturafrågor

Malltext:
"Om du vill byta från faktura kan du lägga till autogiro i Mina sidor > Prenumeration.
Om du vill betala med kort kan alternativ vara att avsluta nuvarande konto och registrera nytt med kortbetalning."`,

  'Supportmall: Inloggning kunder': `Ämne: Inloggning/registreringslänk

Malltext:
"Om du inte kan logga in saknas ofta slutförd registrering på Mina sidor.
Skicka ny registreringslänk, be kunden kontrollera skräppost och bekräfta mejladressens stavning."`,

  'Supportmall: Rabatt': `Ämne: Rabatt (ALMI/ID-skydd)

Malltext:
"Bekräfta om rabatt fallit bort, åtgärda rabatten framåt och informera om eventuell makulering/återbetalning av senaste faktura enligt beslut.
Bekräfta tydligt vilken rabattnivå som gäller framåt och när pengarna syns på kontot (normalt 5–10 dagar)."`,

  'Supportmall: Onboarding': `Ämne: Onboarding / komma igång

Startguide till kund:
1) Upplysningar: följ guider för upplysningssajter.
2) Avindexering: skicka in rekommenderade + egna Google-länkar.
3) Hackskydd (Premium): lägg till bevakade mejladresser.
4) ID-skydd: följ kredit-/risköversikt på Mina sidor.

Malltext:
"Välkommen! Börja i Mina sidor med Upplysningar och Avindexering, så kommer du snabbt igång.
När länkarna är inskickade sköter vi bearbetningen och du följer allt i realtid."`,

  'Supportmall: IMY avindexering': `Ämne: Lång väntetid hos Google / IMY-klagomål

Malltext:
"Normalt hanteras länkar inom 8 veckor, men Googles svarstider kan ibland vara längre.
Om ett ärende har dragit ut länge kan kunden skicka klagomål till IMY.
Hänvisa till guide: https://www.doldadress.se/support/imy-klagomal och inkludera kundens ärendenummer i svaret."`,
};

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: {
      OR: [{ id: TARGET_TENANT }, { subdomain: TARGET_TENANT }],
    },
    select: { id: true, subdomain: true },
  });

  if (!tenant) throw new Error(`Tenant '${TARGET_TENANT}' hittades inte.`);

  let updated = 0;
  let missing = 0;

  for (const [title, content] of Object.entries(conciseArticles)) {
    const existing = await prisma.knowledgeBase.findFirst({
      where: { tenantId: tenant.id, title },
      select: { id: true },
    });

    if (!existing) {
      missing += 1;
      console.log(`Saknas: ${title}`);
      continue;
    }

    await prisma.knowledgeBase.update({
      where: { id: existing.id },
      data: {
        content,
        isActive: true,
      },
    });

    updated += 1;
  }

  console.log(`Klar. Uppdaterade: ${updated}, saknade: ${missing}, tenant: ${tenant.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
