# Magic3 dashboard

This local Web Bluetooth tool synchronizes the time, reads health and activity data, changes watch settings, and installs compatible watch faces on a Magic3/C17 running the original Da Fit firmware with manufacturer ID `MOYOUNG-V2`.

The interface uses Da Fit's light cards and turquoise accent colour. Functions are split across four screens: **Today** for health and activity, **Watch** for settings, **Watch face** for the editor and uploader, and **More** for exports and the technical log. The Bluetooth connection remains available at the top of every screen.

## Getting started

1. Extract the complete zip archive.
2. Close Da Fit and any other program connected to the watch.
3. Double-click `start-health-viewer.cmd` and leave the terminal window open.
4. Use the page that opens in Chrome or Edge.
5. Click **Connect**, followed by **Refresh data**.
6. Export the collected data as CSV or JSON if required.

After initial approval, the page remembers the selected C17 while it remains open. Browsers that support `navigator.bluetooth.getDevices()` can also find a previously approved watch after reopening the page. The connect button will then show the watch name and reconnect directly. Use **Choose another watch** to deliberately open the device chooser again. When this experimental browser feature is unavailable, Web Bluetooth requires one selection, but the chooser is filtered to the Moyoung service and known Magic3/C17 names.

Bluetooth permission belongs to the website address. Always start the tool with `start-health-viewer.cmd` and use the same browser profile. A changed port or cleared browser permission requires selecting the watch once again.

The local server automatically selects a free port between 8840 and 8870. Node.js and Python are not required.

## Health and activity data

- Daily totals for today and the previous two days: steps, distance, and calories.
- Recent sleep stages: awake, light sleep, deep sleep, and REM.
- Up to two days of stored heart-rate samples, when supported by the firmware.
- A live heart-rate measurement through Moyoung command `0x6D`.
- An experimental blood-pressure estimate through Moyoung command `0x69`, when supported.
- Date and time synchronization through Moyoung command `0x31`.

## Watch settings

The dashboard can read and change these Da Fit settings directly:

- daily step goal, 12/24-hour notation, and metric or imperial units;
- raise-to-wake with an optional time window;
- a do-not-disturb schedule;
- movement reminders with interval, minimum steps, and active hours;
- up to eight alarm slots with repeat days;
- **Find my watch** to trigger a vibration or sound.

Read the current values first. Every card has its own save button so unrelated settings are not accidentally overwritten with defaults. After saving, the tool reads the relevant command again when supported. Not every Moyoung firmware version supports every setting.

## Creating and installing a watch face

The page includes an official compatible Type-B test watch face from the Da Fit catalogue for firmware family `NBA`, template 34. Use **Load Type-B sample** and upload it first to verify the transfer without installing Da Fit. The watch adds a successful custom face as the sixth item, and the tool activates index 6.

The editor creates watch faces for the 240×280 display:

1. Choose a title, colours, and optionally a JPG, PNG, or WebP background image.
2. Adjust **Background image opacity** to blend that image with the selected background colour or gradient.
3. Choose which fields to show: date, steps, distance, heart rate, and battery. Distance uses the native Moyoung distance field plus the native KM/MI unit fields, so it follows the watch's unit setting. Its digit set contains the additional half-width decimal sprite expected by the firmware. The point uses the same 5×5-on-8×24 geometry as the official template-34 face. At every scale the digit width is kept even and the point sprite exactly half-width, as required by the firmware renderer.
4. Select a digital, horizontal binary BCD, or analogue clock. The four binary rows represent the two hour digits and two minute digits. Bits run from left to right as 8, 4, 2, and 1. Analogue mode uses the native Moyoung `HAND_HOUR` and `HAND_MINUTE` fields, so the watch rotates the hands.
5. Select an element and change its X/Y position or **Scale**. You can also drag it directly in the preview. Both opaque and transparent binary clocks can be enlarged to 150%.
   Activity labels use one consistent layout: the label is placed at the top left and its value starts directly below it. Units remain beside the value.
6. Enable **Transparent elements** to remove the coloured panels. The editor pre-composes the background pixels into dynamic number images because RGB565 has no alpha channel.
7. Click **Build watch face**. The browser creates a complete `.bin` file locally and selects it for upload.
8. Optionally download the file as a backup.
9. Make sure the watch has at least 50% battery, remove it from its charger, and connect it.
10. Click **Upload watch face** and leave both the page and terminal open until 100% and the receipt confirmation appear.

You can also select an existing Moyoung/Da Fit watch face with file type `0x04`, `0x81`, or `0x84`.

The upload uses characteristic `FEE6`. Built-in watch faces and firmware are not overwritten. If the watch does not confirm the transfer, the tool does not activate the new file.

## Technical notes

MOY-NBA5 uses visible indices starting at 1. It has five built-in faces before an upload; a successful Type-B installation adds the custom face as item 6. The tool selects index 6 with command `0x19` and verifies the active index with `0x29`.

The editor generates Moyoung Type B with file ID `0x81`, a 1,900-byte header, and raw RGB565 images. The measured `0x84` response ends in `0x22` for template 34. Image data is compressed locally in 1,024-byte blocks with LZO1X-1 and aligned like Da Fit's `MiniLzoHelper`. Unpacked image storage is limited to 300 KiB. The bundled `template34-3056-color-impression.bin` comes from the official catalogue API and remains available as a reference file.

RGB565 has no true alpha channel. Transparent elements are therefore pre-composed against the chosen background. Variable-length values such as steps can show small repeating background areas on highly detailed photographs; a quiet background works best. The binary clock uses shared physical storage for identical on/off images while retaining all ten logical digit indices required by the firmware. Binary bit cells and small number cells are also tightly cropped, allowing a transparent binary clock to reach 150% while remaining within the 300 KiB unpacked-image limit.

For MOY-NBA5, the uploader rejects compressed files larger than 300 kB. The fixed unpacked Type-B image space is also 300 KiB.

The uploader follows the CRP transfer sequence found through static analysis of the Da Fit SDK. A response such as `0x74 00 01` requests block 1; it is not a final receipt. Before transfer, command `0xBA 01` asks the watch for its desired file-block size. CRP protocol V2 sends requested file blocks directly to FEE6. Only the legacy route adds an `FE`/CRC/length wrapper. After the final block, the uploader compares the watch's full-file CRC with the local CRC. It reports success and selects index 6 only after a match.

Repeated requests for the same block are coalesced while different block requests retain their received order. Like Da Fit, protocol V2 uses acknowledged GATT writes when FEE6 supports them. CRP frames use 244-byte fragments after MTU negotiation and automatically fall back to 20 bytes when the Windows Bluetooth stack rejects that size.

During a live heart-rate or blood-pressure measurement, the optical sensor is started temporarily and always stopped afterwards, including after a timeout. Health data remains inside the open page and is written to disk only when you explicitly export it.

Heart rate, sleep, and especially the cuffless blood-pressure estimate from this consumer watch are not medical measurements.

The health functions use the open-source [Gadgetbridge Moyoung protocol description](https://gadgetbridge.org/internals/specifics/moyoung-protocol/). Watch-face transfer uses the interactive block and CRC sequence from the CRP SDK in the Da Fit APK. Header construction follows the publicly documented [DaWFT](https://github.com/david47k/dawft) structure. Type-B block packaging was derived through static analysis of Da Fit's `MiniLzoHelper`; the LZO1X-1 compressor is based on the MIT-licensed clean-room `lzo1x` implementation. The Da Fit APK is neither installed nor executed.
