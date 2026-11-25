# Postplanner – foto-opslag V1

Nieuwe foto's bij posts én ideeën worden in de browser tot maximaal 1600 pixels
aan de langste zijde verkleind, zonder vergroting of uitsnede. De eerste WebP-versie
gebruikt kwaliteit 82%; boven 650 KiB worden 72% en 62% geprobeerd. Dit is een
streefwaarde, geen harde bestandsgrootte. Transparantie blijft behouden. GIF wordt
een stilstaand beeld. Een kleiner origineel blijft behouden als het al binnen de
afmetingen valt. De maximale invoergrootte blijft 10 MB.

Foto's en documentbijlagen gaan als binaire bestanden naar de private Storage-bucket
`postplanner-media`. De database en lokale cache bewaren alleen naam, type, grootte,
bucket en pad. Tijdelijke afbeeldingslinks worden uitsluitend in het geheugen
bewaard, na terugkeer naar het tabblad en elke 30 minuten vernieuwd. Bij een volle
lokale cache kan een post nog steeds online worden opgeslagen. Een uploadfout laat
de vorige bijlage en de open invoer intact.

## Ingebruikname

1. Voer `supabase/Foto-opslag-V1.sql` eenmaal uit in de SQL Editor van het bestaande
   Supabase-project. Het script gebruikt een transactie en past de bestaande tabel
   `linkedin_posts` of de tabelrechten niet aan. Bij opnieuw uitvoeren geven de
   bestaande policynamen een fout: de eerdere inrichting blijft intact.
2. Publiceer `index.html` **samen met** `media-storage.js`. Zet eerst Storage klaar.
3. Controleer een nieuwe foto bij een post en bij een idee, ook na herladen.
4. Sluit een geopende post en klik op **Foto-opslag bijwerken**. De browser biedt
   eerst een JSON-back-up aan. Bewaar deze. Oude inline bijlagen worden per post of
   idee omgezet. Sluit de pagina niet tot de voortgang is afgerond.
5. Controleer het resultaat en herlaad. Mislukte items behouden de oude inhoud en
   kunnen opnieuw worden geprobeerd; al omgezette items worden overgeslagen.

De GitHub-koppeling kan het SQL-script niet in Supabase uitvoeren. De bucket en
live uploads zijn daarom pas na stap 1 in de echte omgeving te controleren.

## Bestaande bestanden en herstel

Tijdens omzetting wordt pas na bevestiging door de database de inline inhoud
vervangen. Een voorwaardelijke update voorkomt overschrijven als de bijlagen in
de tussentijd op een ander apparaat zijn aangepast. Lokale posts die nog geen
online rij hebben worden met insert toegevoegd (een gelijktijdige insert faalt
veilig). Een fout stopt andere posts/ideeën niet. De back-up bevat de lokale posts,
ideeën, mappen en de vooraf opgehaalde online rijen.

De back-up is een herstelbestand voor handmatig herstel, geen importfunctie.
Een beheerder kan de betreffende rij in `linkedin_posts` terugzetten vanuit
`remoteRows` of de lokale JSON uit `posts`/`ideaDocuments` herstellen. Bewaar
vooraf ook een Supabase-back-up. Met alleen oude code terugrollen blijven reeds
omgezette foto’s onzichtbaar: herstel dan ook de betrokken bijlagegegevens.

Bestanden worden niet automatisch verwijderd uit Storage bij verwijderen van een
post, vervangen van een foto, afbreken van de editor of een mislukte database-write.
Zo kunnen gedeelde verwijzingen en herstel niet stukgaan. Niet meer gebruikte
bestanden kunnen later door een beheerder worden opgeruimd. Bij een herhaalde
mislukte migratie kunnen ongekoppelde uploads ontstaan.

## Toegang

De huidige planner heeft geen login en gebruikt de Supabase anon-rol. Het SQL-script
houdt dat gedeelde toegangsmodel aan, uitsluitend voor deze bucket en de map
`planner/`. De bucket is private, maar dit geeft geen scheiding tussen gebruikers:
clients met de bestaande openbare anon-key kunnen de bestanden in die map lezen
en nieuwe bestanden toevoegen. De app voegt geen service-role-key toe. Voor
persoonlijke toegangsrechten is eerst een aparte loginwijziging nodig.

## Validatie

De meegeleverde Node-test start een afzonderlijke Edge-headless-sessie met een
lokale Supabase-testclient; echte database en Storage worden niet geraakt:

```powershell
node tests/media-storage.test.cjs
```

Deze controle dekt beeldverkleining, transparantie, bestandsverwijzingen,
bewaren/herladen, volle browseropslag, upload-/databasefouten, en geslaagde,
mislukte en herhaalde omzettingen. De live SQL-policies zijn hiermee niet getest.
