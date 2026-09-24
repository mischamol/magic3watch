# Magic3 dashboard

Deze lokale Web-Bluetooth-tool synchroniseert de tijd, haalt gegevens op en kan een compatibele watchface installeren op een Magic3/C17 met originele Da Fit-firmware en fabrikant-ID `MOYOUNG-V2`.

De interface volgt de lichte kaartstijl en turquoise accentkleur van Da Fit. De vaste navigatie verdeelt de functies over vier schermen: **Vandaag** voor gezondheid en activiteit, **Horloge** voor instellingen, **Wijzerplaat** voor de editor en upload, en **Meer** voor export en het technische logboek. De Bluetooth-verbinding blijft bovenaan ieder scherm bereikbaar.

## Starten

1. Pak het zipbestand volledig uit.
2. Sluit Da Fit en andere programma's die met het horloge verbonden zijn.
3. Dubbelklik op `start-health-viewer.cmd` en laat het terminalvenster open.
4. Gebruik de geopende pagina in Chrome of Edge.
5. Klik **Verbinden** en daarna **Gegevens vernieuwen**.
6. Exporteer desgewenst alles als CSV of JSON.

Na de eerste bevestiging onthoudt de pagina het gekozen C17-horloge zolang zij geopend blijft. Browserversies die `navigator.bluetooth.getDevices()` ondersteunen kunnen het eerder toegestane horloge ook na opnieuw openen terugvinden; dan verandert de verbindingsknop in **C17 verbinden** en wordt rechtstreeks opnieuw verbonden. Met **Ander horloge** kun je bewust opnieuw kiezen. Wanneer de browser deze experimentele heropenfunctie niet ondersteunt, blijft vanwege Web Bluetooth-beveiliging één keuze nodig, maar de apparaatkiezer wordt dan gefilterd op het Moyoung-servicetype en bekende Magic3/C17-namen in plaats van de volledige Bluetooth-lijst.

Bluetooth-toestemming hoort bij het websiteadres. Start de tool daarom steeds met `start-health-viewer.cmd` en gebruik hetzelfde browserprofiel; bij een ander poortnummer of een gewiste browsertoestemming moet je één keer opnieuw kiezen.

De lokale server zoekt zelf een vrije poort tussen 8840 en 8870. Node.js en Python zijn niet nodig.

## Wat wordt gelezen?

- Dagtotalen voor vandaag, gisteren en eergisteren: stappen, afstand en calorieën.
- Recente slaapfasen: wakker, lichte slaap, diepe slaap en REM.
- Maximaal twee dagen opgeslagen hartslagwaarden, als jouw firmware die functie ondersteunt.
- Een actuele hartslagmeting via Moyoung-commando `0x6D`.
- Een experimentele bloeddrukschatting via Moyoung-commando `0x69`, als jouw firmware reageert.
- Datum en tijd synchroniseren via Moyoung-commando `0x31`.

## Horloge-instellingen

Het dashboard kan de volgende Da Fit-instellingen rechtstreeks uitlezen en aanpassen:

- dagelijks stappendoel, 12/24-uursnotatie en metrische of imperiale eenheden;
- polsactivering met een optioneel tijdvenster;
- een niet-storen-schema;
- bewegingsherinneringen met interval, minimale stappen en actieve uren;
- maximaal acht wekkerslots met herhaaldagen;
- **Vind mijn horloge** om een tril- of geluidssignaal te starten.

Lees eerst de waarden uit. Iedere kaart heeft een eigen knop, zodat andere instellingen niet per ongeluk met standaardwaarden worden overschreven. Na opslaan leest de tool het betreffende commando opnieuw uit wanneer de firmware dat ondersteunt. Niet iedere Moyoung-firmware ondersteunt alle instellingen.

## Watchface installeren

De pagina bevat nu een officiële, compatibele Type-B-testwatchface uit de Da Fit-catalogus voor firmwarefamilie `NBA` en template 34. Klik eerst op **Type-B-voorbeeld laden** en upload die. Het horloge voegt de custom watchface toe als zesde item en de tool activeert daarna index 6. Daarmee kun je testen zonder Da Fit te installeren.

Daarnaast staat in de pagina een eenvoudige watchface-maker voor het 240×280-scherm:

1. Kies een titel, kleuren en eventueel een eigen JPG-, PNG- of WebP-achtergrond.
2. Kies welke velden je wilt tonen: datum, stappen, hartslag en batterij.
3. Kies een gewone digitale klok, een horizontale binaire BCD-klok of een analoge klok. De vier binaire regels vormen achtereenvolgens de twee uur- en twee minuutcijfers; de grotere bits staan van links naar rechts onder 8, 4, 2 en 1. De analoge modus gebruikt de native MoYoung-velden `HAND_HOUR` en `HAND_MINUTE`, zodat het horloge de wijzers zelf draait.
4. Verplaats tijd, datum, stappen, hartslag of batterij door het onderdeel in het horlogevoorbeeld te slepen. Voor precieze plaatsing kun je de X- en Y-positie invoeren.
5. Schakel eventueel **transparante onderdelen** in. De gekleurde panelen verdwijnen en de maker bakt de onderliggende achtergrondpixels in de dynamische cijferafbeeldingen.
6. Klik **Watchface maken**. De browser bouwt lokaal een compleet `.bin`-bestand en selecteert dit voor upload.
7. Download het bestand eventueel als reservekopie.
8. Zorg voor minimaal 50% batterij, haal het horloge van de lader en verbind het horloge.
9. Klik **Watchface uploaden** en laat pagina en terminal open tot 100% en de ontvangstbevestiging zichtbaar zijn.

Je kunt daarnaast nog steeds een bestaande MoYoung/Da Fit-watchface met bestandstype `0x04`, `0x81` of `0x84` kiezen.

De upload gebruikt characteristic `FEE6`. Ingebouwde watchfaces en de firmware worden niet overschreven. Als het horloge de overdracht niet bevestigt, activeert de tool het nieuwe bestand niet.

De MOY-NBA5 gebruikt zichtbare indices vanaf 1. Voor de upload zijn er vijf ingebouwde watchfaces; na een geslaagde Type-B-installatie verschijnt de custom watchface als zesde item. De tool selecteert daarom index 6 met commando `0x19` en controleert de actieve index met `0x29`.

De maker gebruikt MoYoung Type B met fileID `0x81`, een header van 1900 bytes en ruwe RGB565-afbeeldingen. De gemeten `0x84`-respons eindigt op `0x22` (template 34). De beeldgegevens worden lokaal in blokken van 1024 bytes met LZO1X-1 gecomprimeerd en op dezelfde manier uitgelijnd als Da Fits `MiniLzoHelper`. De uitgepakte beeldruimte is 300 KiB. De meegeleverde `template34-3056-color-impression.bin` komt rechtstreeks uit de officiële catalogus-API en blijft beschikbaar als controlegeval.

RGB565 ondersteunt geen echt alfakanaal. De transparantie-optie wordt daarom vooraf samengesteld met de gekozen achtergrond. Bij de binaire klok gebeurt dit voor ieder bit op iedere regel afzonderlijk, zodat een verloop of foto achter alle vier regels blijft aansluiten. Velden met een wisselend aantal cijfers, zoals stappen, kunnen op een zeer gedetailleerde foto kleine herhalende achtergrondvlakjes vertonen; een rustige achtergrond werkt daar het best.

Voor de MOY-NBA5 blokkeert de uploader bestanden groter dan 300 kB. Dit is de grootte van het gecomprimeerde uploadbestand; de vaste uitgepakte Type-B-beeldruimte is eveneens 300 KiB.

De actuele uploader volgt de CRP-overdracht uit de statisch onderzochte Da Fit-SDK. Een antwoord zoals `0x74 00 01` is geen ontvangstbevestiging, maar een verzoek om blok 1. Voor de overdracht vraagt de uploader met commando `0xBA 01` de gewenste bestandsblokgrootte aan het horloge; Da Fit gebruikt dezelfde callback om zijn bestandslezer opnieuw in te stellen. Bij CRP-protocol V2 gaan de opgevraagde bestandsblokken rauw naar FEE6. Alleen de oudere protocolroute voegt een `FE`/CRC/lengte-omhulling toe. Na het laatste blok vergelijkt de uploader ook de CRC van het volledige bestand met de CRC die het horloge terugstuurt. Alleen bij een overeenkomst wordt installatie bevestigd en de toegevoegde index 6 geselecteerd.

Herhaalde verzoeken voor hetzelfde blok worden samengevoegd, maar verschillende blokverzoeken blijven in de ontvangen volgorde staan. Net als Da Fit gebruikt de uploader bij CRP-protocol V2 bevestigde GATT-schrijfacties als FEE6 die ondersteunt. De CRP-frames worden na MTU-onderhandeling in stukken van 244 bytes geschreven; als de Windows Bluetooth-stack die grootte afwijst, schakelt de uploader automatisch terug naar 20 bytes.

Bij de horizontale BCD-klok is de ongebruikte 16-kolom volledig verwijderd. Alleen de dynamische bits 8, 4, 2 en 1 worden per cijfer opgeslagen. Hun compacte uitsnedes houden ook een transparante klok met fotoachtergrond binnen de beschikbare beeldruimte.

Bij een actuele hartslag- of bloeddrukmeting wordt de optische sensor tijdelijk gestart en daarna altijd gestopt, ook bij een time-out. Gezondheidsdata blijft lokaal in de geopende pagina en wordt alleen als bestand opgeslagen wanneer je zelf op exporteren klikt.

Hartslag, slaap en vooral de bloeddrukschatting van dit consumentenhorloge zijn geen medische metingen. De bloeddrukwaarde wordt zonder manchet of druksensor door de horlogefirmware geschat.

De gezondheidsfuncties zijn gebaseerd op de open-source [Gadgetbridge Moyoung-protocolbeschrijving](https://gadgetbridge.org/internals/specifics/moyoung-protocol/). De watchface-overdracht gebruikt de interactieve blok- en CRC-reeks uit de CRP SDK in de Da Fit-APK; de custom watchface verschijnt na installatie als zichtbare index 6. De headeropbouw volgt de openbaar beschreven structuur van [DaWFT](https://github.com/david47k/dawft); de Type-B-blokverpakking is afgeleid uit statische analyse van Da Fits `MiniLzoHelper`. De LZO1X-1-compressor is gebaseerd op de MIT-gelicentieerde clean-roomimplementatie `lzo1x`. De Da Fit-APK is niet geïnstalleerd of uitgevoerd.
