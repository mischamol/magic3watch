# Magic3/C17 MOYOUNG-V2 Windows-flasher

Experimentele herimplementatie van uitsluitend de eerste DaFlasher-stap voor de Magic3/C17. De protocolimplementatie is afgeleid van de openbare broncode van `atc1441/D6Flasher`.

## Gebruik

1. Zorg dat de accu minstens 60% vol is en sluit andere Bluetooth- en DaFit-apps.
2. Dubbelklik `start-flasher.cmd`. Laat het terminalvenster open. De starter gebruikt alleen het standaard aanwezige Windows PowerShell; Node.js of Python is niet nodig. Als poort 8765 al bezet is, kiest hij automatisch een vrije poort tot en met 8795.
3. Gebruik de geopende pagina in Chrome of Edge.
4. Download en selecteer exact [`step1_espruino_2v10.102_magic3-dafit.bin`](https://github.com/enaon/eucWatch/raw/main/tools/hackme2/step1_espruino_2v10.102_magic3-dafit.bin) uit de eucWatch-handleiding.
5. Verbind het horloge. De tool vereist fabrikant-ID `MOYOUNG-V2`.
6. Lees de waarschuwing en start pas daarna de flash.

De firmware wordt uitsluitend geaccepteerd bij deze eigenschappen:

- grootte: `243712` bytes;
- SHA-256: `DEDCD5C3656E125A88CCC84DC2F60BB8824994CAC59F9E8C5704110B24B6A223`.

Na een geslaagde CRC-controle installeert het horloge de image intern. Laat het enkele minuten met rust. Een zwart scherm is daarna normaal: Espruino tekent niet automatisch een interface.

## Status en risico

De webinterface en bestandscontroles zijn lokaal getest. De BLE-flash zelf kan alleen met het fysieke horloge worden gevalideerd en is daarom experimenteel. Een verbroken of foutieve update kan SWD-herstel vereisen. Gebruik is op eigen risico.
