# Magic3 dashboard

Deze lokale Web-Bluetooth-tool synchroniseert de tijd, haalt gegevens op en kan een compatibele watchface installeren op een Magic3/C17 met originele Da Fit-firmware en fabrikant-ID `MOYOUNG-V2`.

## Starten

1. Pak het zipbestand volledig uit.
2. Sluit Da Fit en andere programma's die met het horloge verbonden zijn.
3. Dubbelklik op `start-health-viewer.cmd` en laat het terminalvenster open.
4. Gebruik de geopende pagina in Chrome of Edge.
5. Klik **Magic3 kiezen** en daarna **Gegevens uitlezen**.
6. Exporteer desgewenst alles als CSV of JSON.

De lokale server zoekt zelf een vrije poort tussen 8840 en 8870. Node.js en Python zijn niet nodig.

## Wat wordt gelezen?

- Dagtotalen voor vandaag, gisteren en eergisteren: stappen, afstand en calorieën.
- Recente slaapfasen: wakker, lichte slaap, diepe slaap en REM.
- Maximaal twee dagen opgeslagen hartslagwaarden, als jouw firmware die functie ondersteunt.
- Een actuele hartslagmeting via Moyoung-commando `0x6D`.
- Een experimentele bloeddrukschatting via Moyoung-commando `0x69`, als jouw firmware reageert.
- Datum en tijd synchroniseren via Moyoung-commando `0x31`.

## Watchface installeren

1. Gebruik een MoYoung/Da Fit-watchfacebestand met extensie `.bin` en bestandstype `0x04`, `0x81` of `0x84`.
2. Zorg voor minimaal 50% batterij en haal het horloge van de lader.
3. Verbind het horloge, kies het bestand en controleer de getoonde bestandsinformatie.
4. Klik **Watchface uploaden** en laat pagina en terminal open tot 100% en de ontvangstbevestiging zichtbaar zijn.

De upload gebruikt characteristic `FEE6` en activeert custom slot 6. Een bestaande custom watchface in slot 6 wordt vervangen; ingebouwde watchfaces en de firmware worden niet overschreven. Als het horloge de overdracht niet bevestigt, activeert de tool het nieuwe bestand niet.

Bij een actuele hartslag- of bloeddrukmeting wordt de optische sensor tijdelijk gestart en daarna altijd gestopt, ook bij een time-out. Gezondheidsdata blijft lokaal in de geopende pagina en wordt alleen als bestand opgeslagen wanneer je zelf op exporteren klikt.

Hartslag, slaap en vooral de bloeddrukschatting van dit consumentenhorloge zijn geen medische metingen. De bloeddrukwaarde wordt zonder manchet of druksensor door de horlogefirmware geschat.

De gezondheidsfuncties zijn gebaseerd op de open-source [Gadgetbridge Moyoung-protocolbeschrijving](https://gadgetbridge.org/internals/specifics/moyoung-protocol/). De watchface-overdracht is gebaseerd op de interoperabele protocolreeks uit [DaFup](https://github.com/VicGuy/DaFup) en gebruikt hetzelfde custom slot 6.
