import {buildTypeBFace,rgbaToRgb565} from "./watchface-builder.js?v=20260923-13";

const APP_VERSION = "2026.09.23-15";

const UUID = {
  service: "0000feea-0000-1000-8000-00805f9b34fb",
  steps: "0000fee1-0000-1000-8000-00805f9b34fb",
  out: "0000fee2-0000-1000-8000-00805f9b34fb",
  input: "0000fee3-0000-1000-8000-00805f9b34fb",
  faceData: "0000fee6-0000-1000-8000-00805f9b34fb",
  deviceInfo: "0000180a-0000-1000-8000-00805f9b34fb",
  manufacturer: "00002a29-0000-1000-8000-00805f9b34fb",
  batteryService: "0000180f-0000-1000-8000-00805f9b34fb",
  batteryLevel: "00002a19-0000-1000-8000-00805f9b34fb",
};
const EXPECTED_MANUFACTURER = "MOYOUNG-V2";
const CMD = { SYNC_TIME:0x31, SLEEP:0x32, PAST:0x33, HEART:0x35, BLOOD_PRESSURE:0x69, HEART_MEASURE:0x6d, SET_FACE:0x19, QUERY_FACE:0x29, QUERY_FACE_COUNT:0x84, DFU_PACKAGE_LENGTH:0xba };
const ARG = { YESTERDAY_STEPS:1, EARLIER_STEPS:2, YESTERDAY_SLEEP:3, EARLIER_SLEEP:4 };
const el = Object.fromEntries(["connect","fetch","syncTime","measureHr","measureBp","exportCsv","exportJson","disconnect","state","vitals","activity","sleep","heart","log","faceFile","loadTypeB","uploadFace","activateCustomFace","faceIndex","faceInfo","faceProgress","faceUploadStatus","facePreview","faceTitle","faceAccent","faceBackgroundColor","faceBackgroundFile","clockStyle","transparentParts","movePart","partX","partY","showDate","showSteps","showHeart","showBattery","buildFace","downloadBuiltFace","builderInfo"].map(id => [id, document.getElementById(id)]));
const conn = { device:null, server:null, steps:null, out:null, input:null, faceData:null, frame:[], expected:0, waiters:[], faceTransfer:null, faceAbortError:null, battery:null, faceTemplate:null };
const MAX_SAFE_FACE_SIZE = 300*1024;
let dataset = freshDataset();
let selectedFace = null;
let generatedFace = null;
let customFaceBackground = null;

function freshDataset() { return { generatedAt:null, device:{}, vitals:{heartRate:[],bloodPressure:[]}, activity:[], sleep:[], heartRate:[] }; }
function log(message, error=false) { el.log.textContent += `[${new Date().toLocaleTimeString()}] ${message}\n`; el.log.scrollTop=el.log.scrollHeight; (error?console.error:console.log)(message); }
function setState(message, kind="muted") { el.state.className=kind; el.state.textContent=message; }
function delay(ms) { return new Promise(resolve => setTimeout(resolve,ms)); }
function hex(bytes) { return [...bytes].map(v=>v.toString(16).padStart(2,"0")).join(" "); }
function localDate(daysAgo=0) { const d=new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()-daysAgo); return d.toLocaleDateString("sv-SE"); }
function formatDate(iso) { return new Intl.DateTimeFormat("nl-NL",{weekday:"short",day:"numeric",month:"short"}).format(new Date(`${iso}T12:00:00`)); }
function formatNumber(value) { return Number(value).toLocaleString("nl-NL"); }
function uint24le(data, offset) { return data[offset] | (data[offset+1]<<8) | (data[offset+2]<<16); }
function watchTimestamp(date) {
  const localOffsetMinutes=-date.getTimezoneOffset();
  return Math.floor((date.getTime()+(localOffsetMinutes-8*60)*60000)/1000)>>>0;
}
function timePayload(date) {
  const stamp=watchTimestamp(date);
  return [(stamp>>>24)&255,(stamp>>>16)&255,(stamp>>>8)&255,stamp&255,8];
}

function packet(command,payload=[],header=0x20) {
  const result=new Uint8Array(5+payload.length);
  result.set([0xfe,0xea,header,result.length&255,command],0); result.set(payload,5); return result;
}
async function write(value) {
  if (conn.out.writeValueWithResponse) await conn.out.writeValueWithResponse(value); else await conn.out.writeValue(value);
}
async function writeWithoutResponse(characteristic,value) {
  if(characteristic.writeValueWithoutResponse)await characteristic.writeValueWithoutResponse(value);
  else if(characteristic.writeValueWithResponse)await characteristic.writeValueWithResponse(value);
  else await characteristic.writeValue(value);
}
function crc16Crp(bytes,initial=0xfeea) {
  let crc=initial&0xffff;
  for(const byte of bytes){let value=((((crc&255)<<8)|((crc&0xff00)>>>8))^(byte&255));value^=(value&255)>>>4;value^=(value&255)<<12;crc=(value^((value&255)<<5))&0xffff;}
  return crc;
}
function crpFileCrc(bytes) {
  // xgb.c() reads in 4096-byte pieces but carries the previous CRC into g7b.a()
  // for the next piece. This is therefore the CRC of the complete file.
  return crc16Crp(bytes);
}
function queueFaceTransferRequest(payload) {
  const transfer=conn.faceTransfer;if(!transfer||transfer.mode!=="indexed")return false;
  const copy=Uint8Array.from(payload);
  const index=copy.length>=2?(copy[0]<<8)|copy[1]:null;
  transfer.receivedRequests++;
  // The watch repeats its current request while a 260-byte CRP frame is still crossing
  // the 20-byte BLE link. Those repeats are not new work and must never form a backlog.
  if(index!==null&&index===transfer.sendingIndex){transfer.ignoredDuplicates++;return true;}
  const key=hex(copy);
  if(transfer.waiter){const waiter=transfer.waiter;transfer.waiter=null;clearTimeout(waiter.timer);waiter.resolve(copy);}
  else if(transfer.pendingKeys.has(key))transfer.ignoredDuplicates++;
  else {transfer.pendingKeys.add(key);transfer.pendingRequests.push(copy);}
  return true;
}
function nextFaceTransferRequest(timeout=30000) {
  const transfer=conn.faceTransfer;if(!transfer||transfer.mode!=="indexed")return Promise.reject(new Error("De geïndexeerde watchface-overdracht is niet actief."));
  if(transfer.pendingRequests.length){const request=transfer.pendingRequests.shift();transfer.pendingKeys.delete(hex(request));return Promise.resolve(request);}
  return new Promise((resolve,reject)=>{const waiter={resolve,reject,timer:null};waiter.timer=setTimeout(()=>{if(transfer.waiter===waiter)transfer.waiter=null;reject(new Error("Het horloge vroeg niet om het volgende watchfaceblok."));},timeout);transfer.waiter=waiter;});
}
async function sendFaceDataBlock(frame) {
  // alb.a(byte[], packetLength) returns V2 data unchanged. Only the older protocol
  // wraps blocks in FE + CRC + length. FEE6 fragmentation is transport-only.
  const confirmed=Boolean(conn.faceData.properties.write&&conn.faceData.writeValueWithResponse);
  let chunkSize=conn.faceChunkSize||244;
  for(let offset=0;offset<frame.length;offset+=chunkSize){
    const fragment=frame.slice(offset,Math.min(offset+chunkSize,frame.length));
    try{
      if(confirmed)await conn.faceData.writeValueWithResponse(fragment);else await writeWithoutResponse(conn.faceData,fragment);
    }catch(error){
      if(offset===0&&chunkSize>20){conn.faceChunkSize=20;log(`FEE6 accepteert geen fragmenten van ${chunkSize} bytes; veilige terugval naar 20 bytes (${error.message}).`);return sendFaceDataBlock(frame);}
      throw error;
    }
    await delay(confirmed?3:20);
  }
}
function dispatchMessage(message) {
  if(message.command===0x74&&queueFaceTransferRequest(message.payload))return;
  log(`Ontvangen 0x${message.command.toString(16).padStart(2,"0")} (${message.payload.length} bytes): ${hex(message.payload)||"geen payload"}.`);
  const index=conn.waiters.findIndex(w=>w.command===message.command && (!w.match || w.match(message.payload)));
  if(index>=0){ const waiter=conn.waiters.splice(index,1)[0]; clearTimeout(waiter.timer); waiter.resolve(message.payload); }
}
function parseFragment(bytes) {
  if (bytes.length>=5 && bytes[0]===0xfe && bytes[1]===0xea && (bytes[2]===0x10 || bytes[2]>=0x20)) {
    conn.frame=[]; conn.expected=((bytes[2]>=0x20?bytes[2]-0x20:0)<<8)|bytes[3];
  }
  conn.frame.push(...bytes);
  if (conn.expected && conn.frame.length>=conn.expected) {
    const full=new Uint8Array(conn.frame.slice(0,conn.expected)); conn.frame=[]; conn.expected=0;
    dispatchMessage({ command:full[4], payload:full.slice(5) });
  }
}
function shortUuid(uuid) { const match=uuid.match(/^0000([0-9a-f]{4})-/i); return match?match[1].toUpperCase():uuid; }
function notificationReceived(event) {
  const view=event.target.value,bytes=new Uint8Array(view.buffer,view.byteOffset,view.byteLength),source=shortUuid(event.target.uuid);
  const indexedRequest=conn.faceTransfer?.mode==="indexed"&&bytes.length>=5&&bytes[0]===0xfe&&bytes[1]===0xea&&bytes[4]===0x74;
  if(!indexedRequest)log(`BLE-notificatie ${source}: ${hex(bytes)||"leeg"}.`);
  if(bytes.length>=5 && bytes[0]===0xfe && bytes[1]===0xea){parseFragment(bytes);return;}
}
async function monitorCharacteristic(characteristic) {
  if(!(characteristic.properties.notify||characteristic.properties.indicate))return;
  characteristic.addEventListener("characteristicvaluechanged",notificationReceived);
  await characteristic.startNotifications(); log(`Luistert naar BLE-characteristic ${shortUuid(characteristic.uuid)}.`);
}
function awaitResponse(command,match=null,timeout=4000) {
  return new Promise((resolve,reject)=>{
    const waiter={command,match,resolve,reject,timer:null};
    waiter.timer=setTimeout(()=>{ const i=conn.waiters.indexOf(waiter); if(i>=0)conn.waiters.splice(i,1); reject(new Error(`Geen antwoord op commando 0x${command.toString(16)}.`)); },timeout);
    conn.waiters.push(waiter);
  });
}
async function request(command,payload=[],match=null,timeout=4000,header=0x20) {
  const response=awaitResponse(command,match,timeout); await write(packet(command,payload,header)); return response;
}

async function disconnect() {
  conn.waiters.splice(0).forEach(w=>{clearTimeout(w.timer);w.reject(new Error("Verbinding verbroken."));});
  if(conn.faceTransfer?.waiter){clearTimeout(conn.faceTransfer.waiter.timer);conn.faceTransfer.waiter.reject(new Error("Verbinding verbroken."));conn.faceTransfer.waiter=null;}
  if(conn.device?.gatt?.connected) conn.device.gatt.disconnect();
  Object.assign(conn,{server:null,steps:null,out:null,input:null,faceData:null,frame:[],expected:0,faceTransfer:null,faceAbortError:null,battery:null,faceTemplate:null});
  setConnectedControls(false); setState("Niet verbonden.");
}
function disconnected() {
  if(conn.faceTransfer?.waiter){clearTimeout(conn.faceTransfer.waiter.timer);conn.faceTransfer.waiter.reject(new Error("Verbinding verbroken."));conn.faceTransfer.waiter=null;}
  Object.assign(conn,{server:null,steps:null,out:null,input:null,faceData:null,frame:[],expected:0,faceTransfer:null,faceAbortError:null,battery:null,faceTemplate:null});
  setConnectedControls(false); setState("Verbinding verbroken."); log("Verbinding verbroken.");
}
function setConnectedControls(connected) {
  el.connect.disabled=connected; el.fetch.disabled=!connected; el.syncTime.disabled=!connected; el.measureHr.disabled=!connected; el.measureBp.disabled=!connected; el.disconnect.disabled=!connected;
  el.activateCustomFace.disabled=!connected;
  // Keep upload clickable once a face exists, so a missing connection produces a useful explanation instead of a silent disabled button.
  el.uploadFace.disabled=!selectedFace;
  if(!selectedFace){el.uploadFace.title="Maak of kies eerst een watchface";el.faceUploadStatus.className="muted";el.faceUploadStatus.textContent="Maak of kies eerst een watchface.";}
  else if(!connected){el.uploadFace.title="Verbind eerst het horloge";el.faceUploadStatus.className="bad";el.faceUploadStatus.textContent="Watchface gereed. Klik eerst bovenaan op ‘Magic3 kiezen’.";}
  else if(!conn.faceData){el.uploadFace.title="FEE6-datakanaal ontbreekt";el.faceUploadStatus.className="bad";el.faceUploadStatus.textContent="Verbonden, maar het vereiste FEE6-watchfacekanaal is niet gevonden.";}
  else {el.uploadFace.title="Watchface naar het downloadslot sturen";if(!/^(Voltooid|Upload|Overdracht|Index)/.test(el.faceUploadStatus.textContent)){el.faceUploadStatus.className="ok";el.faceUploadStatus.textContent="Klaar voor upload. Laat deze pagina tijdens de overdracht open.";}}
}
function setBusy(busy) {
  for(const button of [el.fetch,el.syncTime,el.measureHr,el.measureBp,el.uploadFace,el.activateCustomFace]) button.disabled=busy;
  el.faceFile.disabled=busy;el.faceIndex.disabled=busy;
  el.buildFace.disabled=busy; el.faceBackgroundFile.disabled=busy;
  if(!busy && !conn.device?.gatt?.connected) setConnectedControls(false);
  else if(!busy)setConnectedControls(true);
}
async function connect() {
  if(!navigator.bluetooth) throw new Error("Web Bluetooth ontbreekt. Gebruik Chrome of Edge op Windows.");
  await disconnect(); log("Selecteer de Magic3/C17 in de Bluetooth-kiezer.");
  conn.device=await navigator.bluetooth.requestDevice({acceptAllDevices:true,optionalServices:[UUID.service,UUID.deviceInfo,UUID.batteryService]});
  conn.device.addEventListener("gattserverdisconnected",disconnected);
  conn.server=await conn.device.gatt.connect();
  const info=await conn.server.getPrimaryService(UUID.deviceInfo);
  const manufacturerValue=await (await info.getCharacteristic(UUID.manufacturer)).readValue();
  const manufacturer=new TextDecoder().decode(manufacturerValue).replace(/\0/g,"").trim();
  if(manufacturer!==EXPECTED_MANUFACTURER){ await disconnect(); throw new Error(`Apparaat geweigerd: fabrikant-ID is “${manufacturer}”, verwacht “${EXPECTED_MANUFACTURER}”.`); }
  const service=await conn.server.getPrimaryService(UUID.service);
  conn.steps=await service.getCharacteristic(UUID.steps); conn.out=await service.getCharacteristic(UUID.out); conn.input=await service.getCharacteristic(UUID.input);
  await monitorCharacteristic(conn.input);
  try{conn.faceData=await service.getCharacteristic(UUID.faceData);const p=conn.faceData.properties,modes=[p.write&&"met antwoord",p.writeWithoutResponse&&"zonder antwoord"].filter(Boolean).join(" en ")||"onbekende schrijfmethode";log(`Watchface-datakanaal FEE6 gevonden (schrijven ${modes}); voor CRP-V2 wordt ${p.write?"met":"zonder"} antwoord gebruikt.`);}catch{conn.faceData=null;log("Watchface-datakanaal FEE6 ontbreekt; uploaden is niet beschikbaar.",true);}
  dataset.device={name:conn.device.name||"Magic3/C17",manufacturer};
  try { const battery=await conn.server.getPrimaryService(UUID.batteryService); dataset.device.battery=(await (await battery.getCharacteristic(UUID.batteryLevel)).readValue()).getUint8(0);conn.battery=dataset.device.battery; } catch { log("Batterijniveau is niet beschikbaar."); }
  setConnectedControls(true);
  setState(`Verbonden met ${dataset.device.name}; ${manufacturer} bevestigd${dataset.device.battery!==undefined?`, batterij ${dataset.device.battery}%`:""}.`,"ok");
  log(`Apparaatcontrole geslaagd: ${manufacturer}. Viewer gereed.`);
}

function decodeActivity(data,daysAgo) {
  if(data.length!==9) throw new Error(`Onverwachte activiteitslengte: ${data.length} in plaats van 9.`);
  return { date:localDate(daysAgo), steps:uint24le(data,0), distanceMeters:uint24le(data,3), calories:uint24le(data,6) };
}
function decodeSleep(data,daysAgo) {
  if(data.length%3!==0) throw new Error(`Onverwachte slaaplengte: ${data.length}.`);
  const stages=[];
  for(let i=0;i<data.length;i+=3){
    const type=data[i], hour=data[i+1], minute=data[i+2];
    if(type>3 || hour>23 || minute>59) continue;
    const at=new Date(); at.setSeconds(0,0); at.setDate(at.getDate()-daysAgo); at.setHours(hour,minute,0,0); if(hour>=20)at.setDate(at.getDate()-1);
    stages.push({type,at:at.toISOString()});
  }
  stages.sort((a,b)=>a.at.localeCompare(b.at));
  return { date:localDate(daysAgo), stages };
}
function decodeHeart(data) {
  if(data.length<2) return [];
  const packetIndex=data[0], daysAgo=Math.floor(packetIndex/4), startHour=(packetIndex%4)*6, result=[];
  for(let i=1;i<data.length && i<=72;i++){
    const bpm=data[i]; if(bpm<30 || bpm>240) continue;
    const minute=(i-1)*5, at=new Date(); at.setSeconds(0,0); at.setDate(at.getDate()-daysAgo); at.setHours(startHour+Math.floor(minute/60),minute%60,0,0);
    if(at<=new Date()) result.push({at:at.toISOString(),bpm});
  }
  return result;
}
async function optionalRequest(command,payload,match,label,timeout=3500) {
  try { return await request(command,payload,match,timeout); }
  catch(error){ log(`${label}: niet beschikbaar (${error.message})`); return null; }
}
async function fetchData() {
  if(!conn.server || !conn.device?.gatt?.connected) throw new Error("Het horloge is niet verbonden.");
  setBusy(true); setState("Gegevens worden uitgelezen…"); const savedVitals=dataset.vitals; dataset=freshDataset(); dataset.vitals=savedVitals; dataset.device={name:conn.device.name||"Magic3/C17",manufacturer:EXPECTED_MANUFACTURER};
  try {
    const today=new Uint8Array(await conn.steps.readValue().then(v=>new Uint8Array(v.buffer,v.byteOffset,v.byteLength))); dataset.activity.push(decodeActivity(today,0));
    for(const [arg,days,label] of [[ARG.YESTERDAY_STEPS,1,"Gisteren"],[ARG.EARLIER_STEPS,2,"Eergisteren"]]){
      const payload=await optionalRequest(CMD.PAST,[arg],p=>p[0]===arg,`${label} activiteit`); if(payload)dataset.activity.push(decodeActivity(payload.slice(1),days)); await delay(180);
    }
    const now=new Date(), sleepOffset=now.getHours()>=20?1:0;
    const currentSleep=await optionalRequest(CMD.SLEEP,[],null,"Recente slaap"); if(currentSleep)dataset.sleep.push(decodeSleep(currentSleep,sleepOffset)); await delay(180);
    for(const [arg,days,label] of [[ARG.YESTERDAY_SLEEP,1-sleepOffset,"Vorige slaap"],[ARG.EARLIER_SLEEP,2-sleepOffset,"Eerdere slaap"]]){
      const payload=await optionalRequest(CMD.PAST,[arg],p=>p[0]===arg,label); if(payload)dataset.sleep.push(decodeSleep(payload.slice(1),days)); await delay(180);
    }
    // CMD 0x35 is the same two-day, five-minute history query used by Gadgetbridge.
    for(let index=0;index<8;index++){
      const payload=await optionalRequest(CMD.HEART,[index],p=>p[0]===index,`Hartslagpakket ${index+1}/8`,index===0?4500:3000);
      if(!payload) break; dataset.heartRate.push(...decodeHeart(payload)); await delay(120);
    }
    dataset.generatedAt=new Date().toISOString(); dataset.activity.sort((a,b)=>b.date.localeCompare(a.date)); dataset.sleep=dataset.sleep.filter(s=>s.stages.length).sort((a,b)=>b.date.localeCompare(a.date)); dataset.heartRate.sort((a,b)=>a.at.localeCompare(b.at));
    render(); el.exportCsv.disabled=false; el.exportJson.disabled=false;
    setState(`Uitgelezen: ${dataset.activity.length} activiteitsdagen, ${dataset.sleep.length} slaapperioden en ${dataset.heartRate.length} hartslagmetingen.`,"ok");
  } finally { setBusy(false); }
}

async function syncTime() {
  if(!conn.device?.gatt?.connected) throw new Error("Het horloge is niet verbonden.");
  setBusy(true);
  try {
    const now=new Date(); await write(packet(CMD.SYNC_TIME,timePayload(now)));
    setState(`Tijd gesynchroniseerd: ${now.toLocaleString("nl-NL")}.`,"ok"); log(`Lokale datum en tijd verzonden (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`);
  } finally { await delay(700); setBusy(false); }
}

async function measureHeartRate() {
  if(!conn.device?.gatt?.connected) throw new Error("Het horloge is niet verbonden.");
  setBusy(true); setState("Hartslag wordt gemeten… Houd je arm stil."); log("Actuele hartslagmeting gestart (commando 0x6d).");
  try {
    const payload=await request(CMD.HEART_MEASURE,[0],p=>p.length>=1 && p[0]>=30 && p[0]<=240,45000);
    const bpm=payload[0]; dataset.vitals.heartRate.push({at:new Date().toISOString(),bpm}); dataset.generatedAt=new Date().toISOString();
    render(); enableExports(); setState(`Actuele hartslag ontvangen: ${bpm} bpm.`,"ok");
  } finally {
    if(conn.device?.gatt?.connected){ try{await write(packet(CMD.HEART_MEASURE,[255]));log("Hartslagsensor gestopt.");}catch(error){log(`Stoppen hartslagsensor mislukte: ${error.message}`,true);} }
    setBusy(false);
  }
}

async function measureBloodPressure() {
  if(!conn.device?.gatt?.connected) throw new Error("Het horloge is niet verbonden.");
  setBusy(true); setState("Experimentele bloeddrukmeting loopt… Houd je arm stil."); log("Bloeddrukmeting gestart (experimenteel commando 0x69).");
  try {
    const payload=await request(CMD.BLOOD_PRESSURE,[0,0,0],p=>p.length>=3 && p[1]>0 && p[1]<255 && p[2]>0 && p[2]<255,45000);
    const systolic=payload[1],diastolic=payload[2]; dataset.vitals.bloodPressure.push({at:new Date().toISOString(),systolic,diastolic,unknown:payload[0]}); dataset.generatedAt=new Date().toISOString();
    render(); enableExports(); setState(`Bloeddrukantwoord ontvangen: ${systolic}/${diastolic} mmHg. Dit is een onbetrouwbare horlogeschatting.`,"ok");
  } finally {
    if(conn.device?.gatt?.connected){ try{await write(packet(CMD.BLOOD_PRESSURE,[255,255,255]));log("Bloeddrukmeting gestopt.");}catch(error){log(`Stoppen bloeddrukmeting mislukte: ${error.message}`,true);} }
    setBusy(false);
  }
}

const FACE_LAYOUT = {panel:"#0b1627",big:{width:42,height:64},small:{width:14,height:22}};
const editorParts = {
  time:{x:12,y:36,width:216,height:92},date:{x:12,y:142,width:94,height:41},
  steps:{x:12,y:191,width:142,height:38},heart:{x:12,y:234,width:142,height:34},battery:{x:164,y:142,width:64,height:41},
};
let draggedPart=null,dragOffset={x:0,y:0};

function roundedRect(context,x,y,width,height,radius,fill) {
  context.beginPath(); context.roundRect(x,y,width,height,radius); context.fillStyle=fill; context.fill();
}
function drawCover(context,image,width,height) {
  const scale=Math.max(width/image.width,height/image.height),drawWidth=image.width*scale,drawHeight=image.height*scale;
  context.drawImage(image,(width-drawWidth)/2,(height-drawHeight)/2,drawWidth,drawHeight);
}
function faceOptions() {
  return {title:el.faceTitle.value.trim()||"MAGIC 3",accent:el.faceAccent.value,background:el.faceBackgroundColor.value,clockStyle:el.clockStyle.value,transparent:el.transparentParts.checked,date:el.showDate.checked,steps:el.showSteps.checked,heart:el.showHeart.checked,battery:el.showBattery.checked};
}
function timeDigitPositions(style="digital"){const p=editorParts.time;return style==="binary"?[[p.x+77,p.y+17],[p.x+77,p.y+35],[p.x+77,p.y+53],[p.x+77,p.y+71]]:[[p.x+12,p.y+14],[p.x+54,p.y+14],[p.x+120,p.y+14],[p.x+162,p.y+14]];}
function fieldPositions(){return {day:[editorParts.date.x+8,editorParts.date.y+15],month:[editorParts.date.x+48,editorParts.date.y+15],steps:[editorParts.steps.x+60,editorParts.steps.y+8],heart:[editorParts.heart.x+60,editorParts.heart.y+4],battery:[editorParts.battery.x+21,editorParts.battery.y+15]};}
function drawFaceBase(context,options) {
  context.clearRect(0,0,240,280);
  if(customFaceBackground){drawCover(context,customFaceBackground,240,280);context.fillStyle="rgba(0,0,0,.28)";context.fillRect(0,0,240,280);}
  else {const gradient=context.createLinearGradient(0,0,0,280);gradient.addColorStop(0,options.background);gradient.addColorStop(1,"#102d4d");context.fillStyle=gradient;context.fillRect(0,0,240,280);}
  context.textBaseline="middle"; context.fillStyle=options.accent;context.font="700 12px Arial,sans-serif";context.fillText(options.title.slice(0,12).toUpperCase(),16,20);
  const time=editorParts.time,date=editorParts.date,battery=editorParts.battery,steps=editorParts.steps,heart=editorParts.heart;
  if(!options.transparent)roundedRect(context,time.x,time.y,time.width,time.height,14,FACE_LAYOUT.panel);
  if(options.clockStyle==="digital"){context.fillStyle=options.accent;context.font="700 42px Arial,sans-serif";context.textAlign="center";context.fillText(":",time.x+108,time.y+45);context.textAlign="left";}
  else {context.fillStyle=options.accent;context.font="700 8px Arial,sans-serif";context.textAlign="center";["16","8","4","2","1"].forEach((label,index)=>context.fillText(label,time.x+60+index*32,time.y+9));context.textAlign="left";context.font="700 8px Arial,sans-serif";["H1","H2","M1","M2"].forEach((label,index)=>context.fillText(label,time.x+8,time.y+25+index*18));context.save();context.strokeStyle=options.accent;context.lineWidth=2;context.globalAlpha=.38;for(let row=0;row<4;row++){context.beginPath();context.arc(time.x+60,time.y+25+row*18,5.5,0,Math.PI*2);context.stroke();}context.restore();}
  context.font="700 8px Arial,sans-serif";
  if(options.date){if(!options.transparent)roundedRect(context,date.x,date.y,date.width,date.height,9,FACE_LAYOUT.panel);context.fillStyle=options.accent;context.fillText("DATUM",date.x+7,date.y+9);context.font="700 16px Arial,sans-serif";context.fillText("/",date.x+39,date.y+27);}
  if(options.battery){if(!options.transparent)roundedRect(context,battery.x,battery.y,battery.width,battery.height,9,FACE_LAYOUT.panel);context.fillStyle=options.accent;context.font="700 8px Arial,sans-serif";context.fillText("BAT",battery.x+7,battery.y+9);context.fillText("%",battery.x+54,battery.y+28);}
  if(options.steps){if(!options.transparent)roundedRect(context,steps.x,steps.y,steps.width,steps.height,9,FACE_LAYOUT.panel);context.fillStyle=options.accent;context.font="700 9px Arial,sans-serif";context.fillText("STAPPEN",steps.x+8,steps.y+19);}
  if(options.heart){if(!options.transparent)roundedRect(context,heart.x,heart.y,heart.width,heart.height,9,FACE_LAYOUT.panel);context.fillStyle=options.accent;context.font="700 9px Arial,sans-serif";context.fillText("HART",heart.x+8,heart.y+17);context.fillText("BPM",heart.x+114,heart.y+17);}
}
function drawExampleDigits(context,options) {
  context.textAlign="center";context.textBaseline="middle";context.fillStyle=options.accent;context.font="700 54px Arial,sans-serif";
  [1,0,0,9].forEach((digit,index)=>{const [x,y]=timeDigitPositions(options.clockStyle)[index];drawTimeGlyph(context,digit,x,y,options.accent,options.clockStyle);});
  context.font="700 18px Arial,sans-serif";
  const draw=(text,x,y)=>[...text].forEach((digit,index)=>context.fillText(digit,x+index*14+7,y+11));
  const positions=fieldPositions();
  if(options.date){draw("19",...positions.day);draw("09",...positions.month);}
  if(options.battery)draw("82",...positions.battery);
  if(options.steps)draw("8240",...positions.steps);
  if(options.heart)draw("68",...positions.heart);
  context.textAlign="left";
}
function renderFacePreview() {
  const context=el.facePreview.getContext("2d",{alpha:false}),options=faceOptions();drawFaceBase(context,options);drawExampleDigits(context,options);
  const selected=editorParts[el.movePart.value];context.save();context.strokeStyle="#ffffff";context.setLineDash([4,3]);context.lineWidth=1;context.strokeRect(selected.x+.5,selected.y+.5,selected.width-1,selected.height-1);context.restore();
}
function editorChanged(){if(generatedFace&&selectedFace?.bytes===generatedFace.bytes)selectedFace=null;generatedFace=null;el.downloadBuiltFace.disabled=true;el.builderInfo.className="muted";el.builderInfo.textContent="Voorbeeld gewijzigd. Klik op ‘Watchface maken’ om het nieuwe .bin-bestand te bouwen.";renderFacePreview();setConnectedControls(Boolean(conn.device?.gatt?.connected));}
function canvasRgb565(canvas) {
  const context=canvas.getContext("2d",{willReadFrequently:true});return rgbaToRgb565(context.getImageData(0,0,canvas.width,canvas.height));
}
function drawTimeGlyph(context,digit,x,y,foreground,style) {
  if(style!=="binary"){context.fillStyle=foreground;context.font="700 54px Arial,sans-serif";context.textAlign="center";context.textBaseline="middle";context.fillText(String(digit),x+21,y+32);return;}
  context.save();context.strokeStyle=foreground;context.fillStyle=foreground;context.lineWidth=2;
  [8,4,2,1].forEach((value,column)=>{context.beginPath();context.arc(x+15+column*32,y+8,5.5,0,Math.PI*2);if(digit&value)context.fill();else{context.globalAlpha=.38;context.stroke();context.globalAlpha=1;}});context.restore();
}
function digitBlobs(width,height,font,foreground,backgroundCanvas=null,x=0,y=0,style="digital") {
  const blobs=[];
  for(let digit=0;digit<=9;digit++){
    const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;const context=canvas.getContext("2d",{alpha:false});
    if(backgroundCanvas)context.drawImage(backgroundCanvas,x,y,width,height,0,0,width,height);else{context.fillStyle=FACE_LAYOUT.panel;context.fillRect(0,0,width,height);}
    if(style==="binary")drawTimeGlyph(context,digit,0,0,foreground,style);else{context.fillStyle=foreground;context.font=font;context.textAlign="center";context.textBaseline="middle";context.fillText(String(digit),width/2,height/2);}
    blobs.push(canvasRgb565(canvas));
  }
  return blobs;
}
function binaryBitBlobs(bitValue,foreground,backgroundCanvas,x,y) {
  const blobs=[];
  for(let digit=0;digit<=9;digit++){
    const canvas=document.createElement("canvas");canvas.width=14;canvas.height=16;const context=canvas.getContext("2d",{alpha:false});
    if(backgroundCanvas)context.drawImage(backgroundCanvas,x,y,14,16,0,0,14,16);else{context.fillStyle=FACE_LAYOUT.panel;context.fillRect(0,0,14,16);}
    context.save();context.strokeStyle=foreground;context.fillStyle=foreground;context.lineWidth=2;context.beginPath();context.arc(7,8,5.5,0,Math.PI*2);
    if(digit&bitValue)context.fill();else{context.globalAlpha=.38;context.stroke();}
    context.restore();blobs.push(canvasRgb565(canvas));
  }
  return blobs;
}
function makeWatchFace() {
  const options=faceOptions(),base=document.createElement("canvas");base.width=240;base.height=280;const baseContext=base.getContext("2d",{alpha:false});drawFaceBase(baseContext,options);
  const preview=document.createElement("canvas");preview.width=240;preview.height=280;const previewContext=preview.getContext("2d",{alpha:false});previewContext.drawImage(base,0,0);drawExampleDigits(previewContext,options);
  const thumbnail=document.createElement("canvas");thumbnail.width=140;thumbnail.height=163;thumbnail.getContext("2d",{alpha:false}).drawImage(preview,0,0,140,163);
  const blobs=[canvasRgb565(base)],addDigitSet=(width,height,font,x,y,style="digital")=>{const index=blobs.length;blobs.push(...digitBlobs(width,height,font,options.accent,options.transparent?base:null,x,y,style));return index;};
  const entries=[{type:0x01,imageIndex:0,x:0,y:0,width:240,height:280}];
  let sharedBig=null,sharedSmall=null;
  if(options.clockStyle==="binary"){
    timeDigitPositions("binary").forEach(([rowX,rowY],row)=>{
      [8,4,2,1].forEach((bitValue,column)=>{
        const x=rowX+8+column*32,y=rowY,imageIndex=blobs.length;
        blobs.push(...binaryBitBlobs(bitValue,options.accent,options.transparent?base:null,x,y));
        entries.push({type:[0x40,0x41,0x43,0x44][row],imageIndex,x,y,width:14,height:16});
      });
    });
  }else{
    timeDigitPositions("digital").forEach(([x,y],index)=>{const imageIndex=sharedBig??=addDigitSet(42,64,"700 54px Arial,sans-serif",x,y);entries.push({type:[0x40,0x41,0x43,0x44][index],imageIndex,x,y,width:42,height:64});});
  }
  const positions=fieldPositions(),smallIndex=(x,y)=>sharedSmall??=addDigitSet(14,22,"700 18px Arial,sans-serif",x,y);
  if(options.date){entries.push({type:0x30,imageIndex:smallIndex(...positions.day),x:positions.day[0],y:positions.day[1],width:14,height:22},{type:0x11,imageIndex:smallIndex(...positions.month),x:positions.month[0],y:positions.month[1],width:14,height:22});}
  if(options.steps)entries.push({type:0x62,imageIndex:smallIndex(...positions.steps),x:positions.steps[0],y:positions.steps[1],width:14,height:22});
  if(options.heart)entries.push({type:0x65,imageIndex:smallIndex(...positions.heart),x:positions.heart[0],y:positions.heart[1],width:14,height:22});
  if(options.battery)entries.push({type:0xd2,imageIndex:smallIndex(...positions.battery),x:positions.battery[0],y:positions.battery[1],width:14,height:22});
  blobs.push(canvasRgb565(thumbnail));
  const faceNumber=50000+(Date.now()%10000),bytes=buildTypeBFace({entries,blobs,faceNumber}),name=`magic3-eigen-${faceNumber}.bin`,meta=inspectFace(bytes);
  generatedFace={name,bytes};selectedFace={file:{name,size:bytes.length},bytes,meta};el.faceProgress.value=0;el.downloadBuiltFace.disabled=false;
  el.faceInfo.className=bytes.length<=MAX_SAFE_FACE_SIZE?"ok":"bad";el.faceInfo.textContent=`${name} · ${(bytes.length/1024).toLocaleString("nl-NL",{maximumFractionDigits:1})} kB · Type B/0x81 · template 34 · ${meta.dataCount} velden${bytes.length>MAX_SAFE_FACE_SIZE?" · te groot voor veilige MOY-NBA5-upload":""}`;
  el.builderInfo.className="ok";el.builderInfo.textContent=`${options.clockStyle==="binary"?"Binaire BCD-watchface":"Watchface"} gebouwd en geselecteerd${options.transparent?" met ingebrande achtergrond achter de cijfers":""}. Je kunt hem downloaden of direct uploaden.`;
  log(`Eigen watchface gebouwd: ${name}, ${bytes.length} bytes, ${entries.length} velden en ${blobs.length} afbeeldingen.`);setConnectedControls(Boolean(conn.device?.gatt?.connected));
}
function syncPositionControls(){const part=editorParts[el.movePart.value];el.partX.value=part.x;el.partY.value=part.y;renderFacePreview();}
function setPartPosition(x,y){const part=editorParts[el.movePart.value];if(!Number.isFinite(x))x=part.x;if(!Number.isFinite(y))y=part.y;part.x=Math.max(0,Math.min(240-part.width,Math.round(x)));part.y=Math.max(0,Math.min(280-part.height,Math.round(y)));el.partX.value=part.x;el.partY.value=part.y;editorChanged();}
function previewPoint(event){const rect=el.facePreview.getBoundingClientRect();return {x:(event.clientX-rect.left)*240/rect.width,y:(event.clientY-rect.top)*280/rect.height};}
function startPartDrag(event){const point=previewPoint(event),keys=Object.keys(editorParts).reverse(),key=keys.find(name=>{const p=editorParts[name];return point.x>=p.x&&point.x<=p.x+p.width&&point.y>=p.y&&point.y<=p.y+p.height;});if(!key)return;el.movePart.value=key;draggedPart=key;dragOffset={x:point.x-editorParts[key].x,y:point.y-editorParts[key].y};el.facePreview.setPointerCapture(event.pointerId);syncPositionControls();}
function movePartDrag(event){if(!draggedPart)return;const point=previewPoint(event);setPartPosition(point.x-dragOffset.x,point.y-dragOffset.y);}
function endPartDrag(event){if(!draggedPart)return;draggedPart=null;if(el.facePreview.hasPointerCapture(event.pointerId))el.facePreview.releasePointerCapture(event.pointerId);}
async function loadFaceBackground() {
  const file=el.faceBackgroundFile.files?.[0];
  if(customFaceBackground?.close)customFaceBackground.close();customFaceBackground=null;
  if(file){if(file.size>10*1024*1024)throw new Error("De achtergrondafbeelding mag maximaal 10 MB zijn.");customFaceBackground=await createImageBitmap(file);}
  editorChanged();
}

function inspectFace(bytes) {
  if(bytes.length<5)throw new Error("Het bestand is te klein om een watchface te zijn.");
  if(bytes.length>4*1024*1024)throw new Error("Het watchfacebestand is groter dan de veilige limiet van 4 MB.");
  const fileId=bytes[0],dataCount=bytes[1],blobCount=bytes[2],faceNumber=bytes[3]|(bytes[4]<<8);
  let type,maxEntries,entrySize;
  if(fileId===0x04){type="A";maxEntries=32;entrySize=6;}
  else if(fileId===0x81||fileId===0x84){type="B/C";maxEntries=39;entrySize=10;}
  else throw new Error(`Onbekend MoYoung-watchfaceformaat 0x${fileId.toString(16).padStart(2,"0")}; verwacht 0x04, 0x81 of 0x84.`);
  if(dataCount>maxEntries)throw new Error(`Ongeldig aantal watchfacevelden: ${dataCount}.`);
  if(bytes.length<5+dataCount*entrySize)throw new Error("De watchfaceheader is afgebroken.");
  if(type==="B/C"&&bytes.length>=1900&&blobCount>0&&400+(blobCount-1)*4+4<=bytes.length){
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),lastOffset=view.getUint32(400+(blobCount-1)*4,true);
    type=1900+lastOffset>bytes.length?"B":"C";
  }
  return {fileId,type,dataCount,blobCount,faceNumber};
}
async function selectFaceFile() {
  selectedFace=null;el.faceProgress.value=0;
  const file=el.faceFile.files?.[0];
  if(!file){el.faceInfo.className="muted";el.faceInfo.textContent="Nog geen watchfacebestand gekozen.";setConnectedControls(Boolean(conn.device?.gatt?.connected));return;}
  try{
    if(!file.name.toLowerCase().endsWith(".bin"))throw new Error("Kies een watchfacebestand met extensie .bin.");
    const bytes=new Uint8Array(await file.arrayBuffer()),meta=inspectFace(bytes);selectedFace={file,bytes,meta};
    el.faceInfo.className="ok";el.faceInfo.textContent=`${file.name} · ${(file.size/1024).toLocaleString("nl-NL",{maximumFractionDigits:1})} kB · type ${meta.type} · face ${meta.faceNumber} · ${meta.dataCount} velden`;
    log(`Watchface gecontroleerd: ${file.name}, fileID 0x${meta.fileId.toString(16)}, ${file.size} bytes.`);
  }catch(error){el.faceInfo.className="bad";el.faceInfo.textContent=error.message;log(`Watchface geweigerd: ${error.message}`,true);}
  setConnectedControls(Boolean(conn.device?.gatt?.connected));
}
async function loadTypeBSample() {
  const response=await fetch("assets/template34-3056-color-impression.bin",{cache:"no-store"});
  if(!response.ok)throw new Error(`De meegeleverde Type-B-watchface kon niet worden geladen (HTTP ${response.status}).`);
  const bytes=new Uint8Array(await response.arrayBuffer()),meta=inspectFace(bytes);
  if(meta.type!=="B"||meta.faceNumber!==3056)throw new Error(`De testwatchface heeft een onverwacht formaat: type ${meta.type}, face ${meta.faceNumber}.`);
  const file={name:"template34-3056-color-impression.bin",size:bytes.length};
  selectedFace={file,bytes,meta};el.faceFile.value="";el.faceProgress.value=0;
  el.faceInfo.className="ok";el.faceInfo.textContent=`${file.name} · ${(bytes.length/1024).toLocaleString("nl-NL",{maximumFractionDigits:1})} kB · officiële Type B · face 3056 · template 34`;
  el.faceUploadStatus.className="ok";el.faceUploadStatus.textContent="Officiële Type-B-testwatchface geladen. Verbind het horloge; na installatie wordt de toegevoegde zesde watchface geselecteerd.";
  log(`Officiële Da Fit Type-B-watchface geladen: ${file.name}, ${bytes.length} bytes.`);setConnectedControls(Boolean(conn.device?.gatt?.connected));
}
async function queryFaceState(label="Watchfacestatus") {
  let count=null,current=null;
  try{const payload=await request(CMD.QUERY_FACE_COUNT,[],null,4500);const profile=payload.length?payload[payload.length-1]:null;if(payload.length===3&&profile===0x22){conn.faceTemplate=profile;log(`${label}: MOY-NBA5-respons ${hex(payload)} eindigt op profiel 0x22 (template 34, 240×280 Type B).`);}else if(payload.length>=2){const candidate=(payload[0]<<8)|payload[1];if(candidate>=1&&candidate<=32)count=candidate;else log(`${label}: 0x84-payload ${hex(payload)} is op deze firmware geen geldige lijstlengte en wordt genegeerd.`);}else log(`${label}: antwoord op aantal was te kort.`,true);}catch(error){log(`${label}: aantal niet beschikbaar (${error.message})`);}
  await delay(120);
  try{const payload=await request(CMD.QUERY_FACE,[],null,4500);if(payload.length)current=payload[0];else log(`${label}: antwoord op actieve index was leeg.`,true);}catch(error){log(`${label}: actieve index niet beschikbaar (${error.message})`);}
  log(`${label}: aantal=${count??"onbekend"}, actief=${current??"onbekend"}.`);return {count,current};
}
function selectedDisplayFace(){const value=Math.round(Number(el.faceIndex.value));if(!Number.isFinite(value)||value<1||value>6)throw new Error("Kies een watchface-index van 1 tot en met 6.");return value;}
function deriveDisplayFace(before,after,preferred) {
  if(before.count!==null&&after.count!==null&&after.count>before.count)return after.count;
  // Template 34 installs its custom face as a new sixth list entry. The
  // firmware's 0x84 response exposes the template id, not the list length,
  // so selecting the old download index (5) leaves the previous face active.
  if(conn.faceTemplate===0x22)return 6;
  if(after.current!==null&&after.current!==before.current)return after.current;
  return preferred;
}
async function setAndVerifyFace(index) {
  await write(packet(CMD.SET_FACE,[index]));await delay(700);
  let verified=null;try{const payload=await request(CMD.QUERY_FACE,[],null,4500);if(payload.length)verified=payload[0];}catch(error){log(`Teruglezen van actieve watchface mislukte: ${error.message}`);}
  return verified;
}
async function queryDfuPackageLength() {
  // Da Fit sends BA 01. Its parser expects response payload [01, low, high]
  // and then replaces the file manager's packet length with that value.
  const payload=await request(CMD.DFU_PACKAGE_LENGTH,[1],data=>data.length>=3&&data[0]===1,4500);
  const length=(payload[2]<<8)|payload[1];
  if(length<20||length>512)throw new Error(`Ongeldige CRP-pakketlengte ${length} in antwoord ${hex(payload)}.`);
  return {length,payload};
}
async function activateLatestFace() {
  if(!conn.device?.gatt?.connected)throw new Error("Verbind eerst het horloge.");setBusy(true);el.faceUploadStatus.className="muted";el.faceUploadStatus.textContent="Watchfacelijst wordt opgevraagd…";
  try{const target=selectedDisplayFace();await queryFaceState("Voor handmatige activatie");const verified=await setAndVerifyFace(target);if(verified!==null&&verified!==target)throw new Error(`Het horloge hield index ${verified} actief in plaats van ${target}.`);el.faceUploadStatus.className="ok";el.faceUploadStatus.textContent=`Index ${target} is geselecteerd${verified===target?" en door het horloge bevestigd":"; teruglezen werd niet ondersteund"}. Controleer het scherm.`;log(`Watchface-index ${target} geselecteerd; teruggelezen=${verified??"onbekend"}.`);}finally{setBusy(false);}
}
async function uploadWatchFace() {
  if(!selectedFace)throw new Error("Kies eerst een geldig .bin-watchfacebestand.");
  if(!conn.device?.gatt?.connected)throw new Error("Verbind eerst het horloge via ‘Magic3 kiezen’ bovenaan de pagina.");
  if(!conn.faceData)throw new Error("Het horloge is verbonden, maar characteristic FEE6 voor watchfacegegevens ontbreekt.");
  if(selectedFace.bytes.length>MAX_SAFE_FACE_SIZE)throw new Error(`Deze watchface is ${(selectedFace.bytes.length/1024).toLocaleString("nl-NL",{maximumFractionDigits:1})} kB. Voor de MOY-NBA5 wordt uit veiligheid maximaal 300 kB toegestaan.`);
  if(conn.battery!==null&&conn.battery>100)throw new Error("Haal het horloge van de lader, verbind opnieuw en probeer dan pas de watchface-upload.");
  if(conn.battery!==null&&conn.battery<50)throw new Error(`Batterij is ${conn.battery}%. Laad eerst op tot minimaal 50%.`);
  const before=await queryFaceState("Compatibiliteitscontrole");
  if(conn.faceTemplate===0x22&&selectedFace.meta.type==="C")throw new Error("Dit horloge meldt template 34 (Type B), maar dit bestand is Type C. De overdracht kan worden bevestigd, maar de firmware zal de watchface niet installeren of tonen. Gebruik een originele Type-B-watchface voor MOY-NBA5/template 34.");
  const bytes=selectedFace.bytes,length=bytes.length;
  let blockSize;
  try{const negotiated=await queryDfuPackageLength();blockSize=negotiated.length;log(`Horloge meldt via 0xBA de CRP-bestandsblokgrootte ${blockSize} bytes (payload ${hex(negotiated.payload)}).`);}
  catch(error){blockSize=244;log(`CRP-pakketlengte kon niet worden opgevraagd; terugval naar V2-standaard 244 bytes (${error.message}).`);}
  const start=new Uint8Array([0xfe,0xea,0x20,0x09,0x74,(length>>>24)&255,(length>>>16)&255,(length>>>8)&255,length&255]);
  const blockCount=Math.ceil(length/blockSize);
  conn.faceChunkSize=244;conn.faceTransfer={mode:"indexed",sent:0,total:length,pendingRequests:[],pendingKeys:new Set(),waiter:null,sendingIndex:null,receivedRequests:0,ignoredDuplicates:0,retries:new Map()};conn.faceAbortError=null;setBusy(true);el.disconnect.disabled=true;el.faceProgress.value=0;el.faceUploadStatus.className="muted";el.faceUploadStatus.textContent=`Geïndexeerde overdracht starten… ${length.toLocaleString("nl-NL")} bytes in ${blockCount.toLocaleString("nl-NL")} blokken.`;setState(`Watchface uploaden: 0% (${length.toLocaleString("nl-NL")} bytes)…`);log(`CRP-watchface-overdracht naar het downloadslot gestart: ${selectedFace.file.name}, blokgrootte ${blockSize}, FEE6-fragment ${conn.faceChunkSize}.`);
  try{
    await writeWithoutResponse(conn.out,start);await delay(500);
    while(true){
      const payload=await nextFaceTransferRequest();
      if(payload.length<2)throw new Error(`Ongeldig 0x74-blokverzoek: ${hex(payload)}.`);
      const index=(payload[0]<<8)|payload[1];
      if(index===0xffff){
        if(payload.length<4)throw new Error("Het horloge meldde het transfereinde zonder bestands-CRC.");
        const watchCrc=(payload[2]<<8)|payload[3],localCrc=crpFileCrc(bytes);
        log(`Da Fit-bestands-CRC (volledig bestand): horloge=0x${watchCrc.toString(16).padStart(4,"0")}, lokaal=0x${localCrc.toString(16).padStart(4,"0")}.`);
        if(watchCrc!==localCrc){await writeWithoutResponse(conn.out,packet(0x74,[255,255,255,255]));throw new Error("CRC-controle mislukt; het horloge ontving niet exact hetzelfde bestand.");}
        await writeWithoutResponse(conn.out,packet(0x74,[0,0,0,0]));el.faceProgress.value=100;el.faceUploadStatus.textContent="CRC bevestigd; het horloge installeert de watchface…";log("CRC-controle geslaagd; installatiebevestiging naar het horloge verzonden.");break;
      }
      if(index>=blockCount)throw new Error(`Het horloge vroeg om ongeldig blok ${index}; dit bestand heeft ${blockCount} blokken.`);
      const attempt=(conn.faceTransfer.retries.get(index)||0)+1;conn.faceTransfer.retries.set(index,attempt);
      if(attempt>30)throw new Error(`Blok ${index} werd na 30 pogingen nog niet geaccepteerd; gebruikte bestandsblokgrootte ${blockSize} en FEE6-fragmentgrootte ${conn.faceChunkSize}.`);
      const offset=index*blockSize,data=bytes.slice(offset,Math.min(offset+blockSize,length));
      conn.faceTransfer.sendingIndex=index;
      await sendFaceDataBlock(data);
      conn.faceTransfer.sendingIndex=null;
      conn.faceTransfer.sent=Math.max(conn.faceTransfer.sent,Math.min(offset+data.length,length));
      const percent=Math.min(99,Math.round(conn.faceTransfer.sent*100/length));el.faceProgress.value=percent;el.faceUploadStatus.textContent=`Blok ${index+1} van ${blockCount} verzonden: ${percent}%${attempt>1?` (poging ${attempt})`:""}.`;setState(`Watchface uploaden: ${percent}%…`);
      if(index===0||index===blockCount-1||index%16===15||attempt>1)log(`Blok ${index} verzonden${attempt>1?` (poging ${attempt})`:""}; voortgang ${percent}%.`);
    }
    await delay(1400);
    const after=await queryFaceState("Na upload"),target=deriveDisplayFace(before,after,selectedDisplayFace());
    if(target===6&&after.count===null)log("Na upload: template 34 voegt de custom watchface toe als zichtbare index 6; die index wordt nu geactiveerd.");
    el.faceIndex.value=String(target);
    const verified=await setAndVerifyFace(target);
    if(verified!==null&&verified!==target)throw new Error(`Upload ontvangen, maar activatie mislukte: horloge meldt index ${verified} in plaats van ${target}.`);
    el.faceProgress.value=100;el.faceUploadStatus.className="ok";el.faceUploadStatus.textContent=`Bestand en CRC bevestigd; zichtbare index ${target} geselecteerd${verified===target?" en teruggelezen":""}. Controleer het horloge.`;setState(`Watchface met geldige CRC geïnstalleerd; index ${target} geactiveerd.`,"ok");log(`Watchface na geslaagde CRC geactiveerd via display-index ${target}; teruggelezen=${verified??"onbekend"}.`);
  }catch(error){
    if(conn.faceTransfer?.waiter){const waiter=conn.faceTransfer.waiter;conn.faceTransfer.waiter=null;clearTimeout(waiter.timer);waiter.reject(error);}
    if(conn.device?.gatt?.connected){try{await writeWithoutResponse(conn.out,packet(0x74,[255,255,255,255]));}catch{}}
    el.faceProgress.value=0;el.faceUploadStatus.className="bad";el.faceUploadStatus.textContent=`Upload gestopt: ${error.message}`;throw error;
  }finally{if(conn.faceTransfer)log(`CRP-verzoeken ontvangen: ${conn.faceTransfer.receivedRequests}; duplicaten tijdens verzending genegeerd: ${conn.faceTransfer.ignoredDuplicates}.`);conn.faceTransfer=null;conn.faceAbortError=null;setBusy(false);}
}

function sleepSegments(stages) {
  return stages.map((stage,i)=>{ const start=new Date(stage.at), end=i+1<stages.length?new Date(stages[i+1].at):new Date(Math.min(Date.now(),start.getTime()+30*60000)); return {...stage,minutes:Math.max(0,Math.round((end-start)/60000))}; }).filter(s=>s.minutes>0 && s.minutes<12*60);
}
function render() {
  const vitalCards=[];
  const latestHr=dataset.vitals.heartRate.at(-1),latestBp=dataset.vitals.bloodPressure.at(-1);
  if(latestHr)vitalCards.push(`<article class="card"><div class="date">Hartslag · ${new Date(latestHr.at).toLocaleString("nl-NL")}</div><div class="big">${latestHr.bpm} bpm</div><div class="muted">Actuele optische meting</div></article>`);
  if(latestBp)vitalCards.push(`<article class="card"><div class="date">Bloeddruk · ${new Date(latestBp.at).toLocaleString("nl-NL")}</div><div class="big">${latestBp.systolic}/${latestBp.diastolic} mmHg</div><div class="bad">Experimentele algoritmische schatting</div></article>`);
  el.vitals.innerHTML=vitalCards.length?vitalCards.join(""):'<div class="empty">Nog geen actuele meting uitgevoerd.</div>';
  el.activity.innerHTML=dataset.activity.length?dataset.activity.map(a=>`<article class="card"><div class="date">${formatDate(a.date)}</div><div class="big">${formatNumber(a.steps)} stappen</div><div class="trio"><span>Afstand<b>${(a.distanceMeters/1000).toLocaleString("nl-NL",{maximumFractionDigits:2})} km</b></span><span>Calorieën<b>${formatNumber(a.calories)} kcal</b></span><span>Dag<b>${a.date}</b></span></div></article>`).join(""):'<div class="empty">Geen activiteitsgegevens ontvangen.</div>';
  el.sleep.innerHTML=dataset.sleep.length?dataset.sleep.map(s=>{ const seg=sleepSegments(s.stages),total=seg.reduce((n,x)=>n+x.minutes,0),asleep=seg.filter(x=>x.type!==0).reduce((n,x)=>n+x.minutes,0); const bars=seg.map(x=>`<i class="stage-${x.type}" style="width:${total?100*x.minutes/total:0}%" title="${["Wakker","Licht","Diep","REM"][x.type]}: ${x.minutes} min"></i>`).join(""); return `<article class="card" style="margin-top:12px"><div class="date">${formatDate(s.date)}</div><div class="big">${Math.floor(asleep/60)} u ${asleep%60} min slaap</div><div class="sleepbar">${bars}</div><div class="muted">${s.stages.length} fasewisselingen · geregistreerde periode ${Math.floor(total/60)} u ${total%60} min</div></article>`; }).join(""):'<div class="empty">Geen slaapgegevens ontvangen.</div>';
  if(dataset.heartRate.length){ const values=dataset.heartRate.map(x=>x.bpm),avg=Math.round(values.reduce((a,b)=>a+b,0)/values.length),recent=[...dataset.heartRate].reverse().slice(0,12); el.heart.innerHTML=`<div class="grid"><div class="card"><div class="date">Gemiddeld</div><div class="big">${avg} bpm</div></div><div class="card"><div class="date">Laagste</div><div class="big">${Math.min(...values)} bpm</div></div><div class="card"><div class="date">Hoogste</div><div class="big">${Math.max(...values)} bpm</div></div></div><table><thead><tr><th>Tijd</th><th>Hartslag</th></tr></thead><tbody>${recent.map(x=>`<tr><td>${new Date(x.at).toLocaleString("nl-NL")}</td><td>${x.bpm} bpm</td></tr>`).join("")}</tbody></table>`; }
  else el.heart.innerHTML='<div class="empty">Het horloge leverde geen opgeslagen hartslagmetingen. Sommige Magic3-firmware bewaart deze niet.</div>';
}
function csvEscape(value){ const s=String(value??""); return /[",\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s; }
function enableExports(){ el.exportCsv.disabled=false;el.exportJson.disabled=false; }
function exportCsv(){ const rows=[["categorie","datum_tijd","stappen","afstand_meter","calorieen_kcal","slaapfase","duur_minuten","hartslag_bpm","systolisch_mmhg","diastolisch_mmhg"]]; dataset.activity.forEach(a=>rows.push(["activiteit",a.date,a.steps,a.distanceMeters,a.calories,"","","","",""])); dataset.sleep.forEach(s=>sleepSegments(s.stages).forEach(x=>rows.push(["slaap",x.at,"","","",["wakker","licht","diep","rem"][x.type],x.minutes,"","",""]))); dataset.heartRate.forEach(x=>rows.push(["hartslag_historie",x.at,"","","","","",x.bpm,"",""])); dataset.vitals.heartRate.forEach(x=>rows.push(["hartslag_actueel",x.at,"","","","","",x.bpm,"",""])); dataset.vitals.bloodPressure.forEach(x=>rows.push(["bloeddruk",x.at,"","","","","","",x.systolic,x.diastolic])); download(`magic3-gezondheid-${localDate()}.csv`,"text/csv;charset=utf-8",'\ufeff'+rows.map(r=>r.map(csvEscape).join(";")).join("\r\n")); }
function exportJson(){ download(`magic3-gezondheid-${localDate()}.json`,"application/json",JSON.stringify(dataset,null,2)); }
function download(name,type,content){ const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement("a"); a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
function fail(error){ log(`FOUT: ${error.message||error}`,true); setState(error.message||String(error),"bad"); setBusy(false); }
function failFaceUpload(error){el.faceUploadStatus.className="bad";el.faceUploadStatus.textContent=`Upload niet gestart: ${error.message||error}`;fail(error);}

el.connect.addEventListener("click",()=>connect().catch(fail)); el.fetch.addEventListener("click",()=>fetchData().catch(fail)); el.syncTime.addEventListener("click",()=>syncTime().catch(fail)); el.measureHr.addEventListener("click",()=>measureHeartRate().catch(fail)); el.measureBp.addEventListener("click",()=>measureBloodPressure().catch(fail)); el.disconnect.addEventListener("click",()=>disconnect().catch(fail)); el.exportCsv.addEventListener("click",exportCsv); el.exportJson.addEventListener("click",exportJson); el.faceFile.addEventListener("change",()=>selectFaceFile().catch(fail)); el.loadTypeB.addEventListener("click",()=>loadTypeBSample().catch(fail)); el.uploadFace.addEventListener("click",()=>uploadWatchFace().catch(failFaceUpload));
el.activateCustomFace.addEventListener("click",()=>activateLatestFace().catch(failFaceUpload));
el.buildFace.addEventListener("click",()=>{try{makeWatchFace();}catch(error){fail(error);}});
el.downloadBuiltFace.addEventListener("click",()=>{if(generatedFace)download(generatedFace.name,"application/octet-stream",generatedFace.bytes);});
el.faceBackgroundFile.addEventListener("change",()=>loadFaceBackground().catch(fail));
for(const input of [el.faceTitle,el.faceAccent,el.faceBackgroundColor,el.clockStyle,el.transparentParts,el.showDate,el.showSteps,el.showHeart,el.showBattery])input.addEventListener("input",editorChanged);
el.movePart.addEventListener("change",syncPositionControls);el.partX.addEventListener("input",()=>setPartPosition(Number(el.partX.value),Number(el.partY.value)));el.partY.addEventListener("input",()=>setPartPosition(Number(el.partX.value),Number(el.partY.value)));
el.facePreview.addEventListener("pointerdown",startPartDrag);el.facePreview.addEventListener("pointermove",movePartDrag);el.facePreview.addEventListener("pointerup",endPartDrag);el.facePreview.addEventListener("pointercancel",endPartDrag);
syncPositionControls();
log(navigator.bluetooth?`Magic3-dashboard ${APP_VERSION} gereed. Kies eerst je Magic3/C17.`:"Web Bluetooth ontbreekt; open via localhost in Chrome of Edge.",!navigator.bluetooth);
