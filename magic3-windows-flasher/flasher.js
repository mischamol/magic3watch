const UUID = {
  fitService: "0000feea-0000-1000-8000-00805f9b34fb",
  commandWrite: "0000fee2-0000-1000-8000-00805f9b34fb",
  commandNotify: "0000fee3-0000-1000-8000-00805f9b34fb",
  dataWrite: "0000fee5-0000-1000-8000-00805f9b34fb",
  deviceInfo: "0000180a-0000-1000-8000-00805f9b34fb",
  manufacturer: "00002a29-0000-1000-8000-00805f9b34fb",
};

const EXPECTED = {
  name: "step1_espruino_2v10.102_magic3-dafit.bin",
  size: 243712,
  sha256: "DEDCD5C3656E125A88CCC84DC2F60BB8824994CAC59F9E8C5704110B24B6A223",
  manufacturer: "MOYOUNG-V2",
  chunkSize: 20,
};

const el = Object.fromEntries(["file", "fileState", "connect", "disconnect", "deviceState", "confirm", "flash", "progress", "progressText", "log"].map(id => [id, document.getElementById(id)]));
const state = { file: null, bytes: null, device: null, server: null, cmd: null, notify: null, data: null, manufacturerOk: false, fileOk: false, flashing: false, rx: [], rxLength: 0, lastPacket: null, offset: 0, packetIndex: -1, crc: null, timeout: null };

function log(message, kind = "") {
  const stamp = new Date().toLocaleTimeString();
  el.log.textContent += `[${stamp}] ${message}\n`;
  el.log.scrollTop = el.log.scrollHeight;
  if (kind === "error") console.error(message); else console.log(message);
}

function hex(bytes) { return [...bytes].map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase(); }
function be32(value) { return new Uint8Array([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]); }
function concat(...parts) { const n = parts.reduce((s,p)=>s+p.length,0); const out=new Uint8Array(n); let o=0; for(const p of parts){out.set(p,o);o+=p.length;} return out; }
function crc16(bytes) {
  let crc = 0xFEEA;
  for (const b of bytes) {
    crc = ((crc >>> 8) | (crc << 8)) & 0xFFFF;
    crc ^= b; crc ^= (crc & 0xFF) >>> 4; crc ^= (crc << 12) & 0xFFFF; crc ^= ((crc & 0xFF) << 5) & 0xFFFF;
  }
  return new Uint8Array([(crc >>> 8) & 255, crc & 255]);
}

async function sha256(bytes) { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))); }

function updateFlashEnabled() { el.flash.disabled = !(state.fileOk && state.manufacturerOk && el.confirm.checked && !state.flashing); }

async function selectFile() {
  state.fileOk = false; state.file = el.file.files[0] || null; state.bytes = null;
  if (!state.file) { el.fileState.textContent = "Nog geen bestand geselecteerd."; updateFlashEnabled(); return; }
  el.fileState.textContent = "Bestand wordt gecontroleerd…";
  const bytes = new Uint8Array(await state.file.arrayBuffer());
  const digest = await sha256(bytes);
  if (state.file.name !== EXPECTED.name || bytes.length !== EXPECTED.size || digest !== EXPECTED.sha256) {
    el.fileState.className = "bad";
    el.fileState.textContent = `Geweigerd. Naam/grootte/hash wijkt af. Grootte=${bytes.length}, SHA-256=${digest}`;
    log("Firmware geweigerd: niet exact het gecontroleerde stap-1-bestand.", "error");
  } else {
    state.fileOk = true; state.bytes = bytes; state.crc = crc16(bytes);
    el.fileState.className = "ok";
    el.fileState.textContent = `Goedgekeurd: ${bytes.length} bytes, SHA-256 ${digest}`;
    log(`Firmware gecontroleerd. CRC16=${hex(state.crc)}`);
  }
  updateFlashEnabled();
}

async function disconnect() {
  clearTimeout(state.timeout);
  if (state.device?.gatt?.connected) state.device.gatt.disconnect();
  state.server = state.cmd = state.notify = state.data = null;
  state.manufacturerOk = false; state.flashing = false;
  el.deviceState.className = "muted"; el.deviceState.textContent = "Niet verbonden.";
  el.connect.disabled = false; el.disconnect.disabled = true; updateFlashEnabled();
}

async function connect() {
  if (!navigator.bluetooth) throw new Error("Web Bluetooth is niet beschikbaar. Gebruik Chrome of Edge op Windows via localhost.");
  await disconnect();
  log("Open de apparaatkiezer en selecteer de Magic3/C17.");
  state.device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [UUID.fitService, UUID.deviceInfo] });
  state.device.addEventListener("gattserverdisconnected", () => {
    const during = state.flashing;
    state.manufacturerOk = false; state.flashing = false;
    el.deviceState.className = during ? "bad" : "muted";
    el.deviceState.textContent = during ? "Verbinding tijdens flashen verbroken." : "Verbinding verbroken.";
    el.connect.disabled = false; el.disconnect.disabled = true; updateFlashEnabled();
    log(during ? "WAARSCHUWING: verbinding tijdens flashen verbroken." : "Verbinding verbroken.", during ? "error" : "");
  });
  state.server = await state.device.gatt.connect();
  const info = await state.server.getPrimaryService(UUID.deviceInfo);
  const mfgChar = await info.getCharacteristic(UUID.manufacturer);
  const mfgValue = await mfgChar.readValue();
  const manufacturer = new TextDecoder().decode(mfgValue).replace(/\0/g, "").trim();
  if (manufacturer !== EXPECTED.manufacturer) throw new Error(`Apparaat geweigerd: fabrikant-ID is “${manufacturer}”, verwacht “${EXPECTED.manufacturer}”.`);
  const service = await state.server.getPrimaryService(UUID.fitService);
  state.cmd = await service.getCharacteristic(UUID.commandWrite);
  state.notify = await service.getCharacteristic(UUID.commandNotify);
  state.data = await service.getCharacteristic(UUID.dataWrite);
  await state.notify.startNotifications();
  state.notify.addEventListener("characteristicvaluechanged", onNotification);
  state.manufacturerOk = true;
  el.deviceState.className = "ok"; el.deviceState.textContent = `Verbonden met ${state.device.name || "Magic3/C17"}; fabrikant-ID ${manufacturer} bevestigd.`;
  el.connect.disabled = true; el.disconnect.disabled = false; updateFlashEnabled();
  log(`Veilige apparaatcontrole geslaagd: ${manufacturer}.`);
}

async function writeWithResponse(characteristic, bytes) {
  if (characteristic.writeValueWithResponse) await characteristic.writeValueWithResponse(bytes);
  else await characteristic.writeValue(bytes);
}

async function sendCommand(size) {
  const payload = be32(size);
  const message = concat(new Uint8Array([0xFE, 0xEA, 0x20, 5 + payload.length, 0x63]), payload);
  await writeWithResponse(state.cmd, message);
}

function armTimeout() {
  clearTimeout(state.timeout);
  state.timeout = setTimeout(async () => {
    log("Geen bevestiging van het horloge ontvangen; overdracht afgebroken. Laat het horloge aan staan en probeer niet willekeurig te herstarten.", "error");
    state.flashing = false; updateFlashEnabled();
  }, 15000);
}

async function sendPacket(position) {
  if (!state.flashing) return;
  if (position > state.packetIndex) {
    state.packetIndex = position;
    if (state.offset >= state.bytes.length) return;
    const end = Math.min(state.offset + EXPECTED.chunkSize, state.bytes.length);
    state.lastPacket = state.bytes.slice(state.offset, end);
    state.offset = end;
  }
  if (!state.lastPacket?.length) return;
  await writeWithResponse(state.data, state.lastPacket);
  const pct = Math.floor(state.offset * 100 / state.bytes.length);
  el.progress.value = pct; el.progressText.textContent = `${pct}% — ${state.offset} / ${state.bytes.length} bytes`;
  armTimeout();
}

async function handleMessage(message) {
  const h = hex(message);
  if (!state.flashing) { log(`Melding buiten flashmodus: ${h}`); return; }
  if (h === "FEEA1007630000") {
    log("Horloge staat in DaFit-update-modus; overdracht gestart.");
    await sendPacket(0); return;
  }
  if (message.length >= 9 && h.startsWith("FEEA100963FFFF")) {
    clearTimeout(state.timeout);
    const remoteCrc = message.slice(7, 9);
    if (hex(remoteCrc) !== hex(state.crc)) throw new Error(`CRC-fout: horloge=${hex(remoteCrc)}, bestand=${hex(state.crc)}. Niet herstarten.`);
    el.progress.value = 100; el.progressText.textContent = "100% — CRC bevestigd; interne installatie gestart";
    log("Volledige overdracht en CRC bevestigd. Horloge opdracht gegeven de image intern te installeren.");
    await sendCommand(0);
    state.flashing = false; updateFlashEnabled();
    log("Klaar met verzenden. Laat het horloge enkele minuten volledig met rust. Het scherm blijft zwart; dat is bij deze Espruino-image normaal.");
    return;
  }
  if (message.length >= 7 && h.startsWith("FEEA100763")) {
    const position = (message[5] << 8) | message[6];
    await sendPacket(position); return;
  }
  log(`Onverwachte protocolmelding: ${h}`);
}

function onNotification(event) {
  const incoming = new Uint8Array(event.target.value.buffer, event.target.value.byteOffset, event.target.value.byteLength);
  if (incoming.length >= 4 && incoming[0] === 0xFE && incoming[1] === 0xEA && incoming[2] === 0x10) {
    state.rx = [...incoming]; state.rxLength = incoming[3];
  } else if (state.rx.length && state.rx.length < state.rxLength) state.rx.push(...incoming);
  if (state.rx.length === state.rxLength) {
    const complete = new Uint8Array(state.rx); state.rx = []; state.rxLength = 0;
    handleMessage(complete).catch(fail);
  }
}

async function flash() {
  if (!(state.fileOk && state.manufacturerOk && el.confirm.checked)) throw new Error("Voorcontrole niet compleet.");
  state.flashing = true; state.offset = 0; state.packetIndex = -1; state.lastPacket = null;
  el.flash.disabled = true; el.connect.disabled = true; el.disconnect.disabled = true; el.file.disabled = true;
  el.progress.value = 0; el.progressText.textContent = "0% — update-modus aanvragen";
  log(`Startcommando voor ${state.bytes.length} bytes verzenden.`);
  await sendCommand(state.bytes.length);
  armTimeout();
}

function fail(error) {
  clearTimeout(state.timeout); state.flashing = false;
  el.file.disabled = false; el.disconnect.disabled = !state.device?.gatt?.connected;
  log(`FOUT: ${error.message || error}`, "error");
  el.deviceState.className = "bad"; el.deviceState.textContent = error.message || String(error);
  updateFlashEnabled();
}

el.file.addEventListener("change", () => selectFile().catch(fail));
el.connect.addEventListener("click", () => connect().catch(fail));
el.disconnect.addEventListener("click", () => disconnect().catch(fail));
el.confirm.addEventListener("change", updateFlashEnabled);
el.flash.addEventListener("click", () => flash().catch(fail));

if (!navigator.bluetooth) log("Web Bluetooth ontbreekt. Open deze pagina via localhost in Chrome of Edge.", "error");
else log("Tool gereed. Selecteer eerst het gecontroleerde stap-1-bestand.");
