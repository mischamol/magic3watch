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
const CMD = { SYNC_TIME:0x31, SLEEP:0x32, PAST:0x33, HEART:0x35, BLOOD_PRESSURE:0x69, HEART_MEASURE:0x6d };
const ARG = { YESTERDAY_STEPS:1, EARLIER_STEPS:2, YESTERDAY_SLEEP:3, EARLIER_SLEEP:4 };
const el = Object.fromEntries(["connect","fetch","syncTime","measureHr","measureBp","exportCsv","exportJson","disconnect","state","vitals","activity","sleep","heart","log","faceFile","uploadFace","faceInfo","faceProgress"].map(id => [id, document.getElementById(id)]));
const conn = { device:null, server:null, steps:null, out:null, input:null, faceData:null, frame:[], expected:0, waiters:[], faceAck:null, battery:null };
let dataset = freshDataset();
let selectedFace = null;

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
function dispatchMessage(message) {
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
  log(`BLE-notificatie ${source}: ${hex(bytes)||"leeg"}.`);
  if(bytes.length>=6 && bytes[0]===0xfe && bytes[1]===0xea && bytes[4]===0x74 && bytes[5]===0xff && conn.faceAck){
    const ack=conn.faceAck;conn.faceAck=null;clearTimeout(ack.timer);ack.resolve(true);return;
  }
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
  if(conn.faceAck){clearTimeout(conn.faceAck.timer);conn.faceAck.reject(new Error("Verbinding verbroken."));conn.faceAck=null;}
  if(conn.device?.gatt?.connected) conn.device.gatt.disconnect();
  Object.assign(conn,{server:null,steps:null,out:null,input:null,faceData:null,frame:[],expected:0,battery:null});
  setConnectedControls(false); setState("Niet verbonden.");
}
function disconnected() {
  if(conn.faceAck){clearTimeout(conn.faceAck.timer);conn.faceAck.reject(new Error("Verbinding verbroken."));conn.faceAck=null;}
  Object.assign(conn,{server:null,steps:null,out:null,input:null,faceData:null,frame:[],expected:0,battery:null});
  setConnectedControls(false); setState("Verbinding verbroken."); log("Verbinding verbroken.");
}
function setConnectedControls(connected) {
  el.connect.disabled=connected; el.fetch.disabled=!connected; el.syncTime.disabled=!connected; el.measureHr.disabled=!connected; el.measureBp.disabled=!connected; el.disconnect.disabled=!connected; el.uploadFace.disabled=!(connected&&conn.faceData&&selectedFace);
}
function setBusy(busy) {
  for(const button of [el.fetch,el.syncTime,el.measureHr,el.measureBp,el.uploadFace]) button.disabled=busy;
  el.faceFile.disabled=busy;
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
  try{conn.faceData=await service.getCharacteristic(UUID.faceData);log("Watchface-datakanaal FEE6 gevonden.");}catch{conn.faceData=null;log("Watchface-datakanaal FEE6 ontbreekt; uploaden is niet beschikbaar.",true);}
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
function waitForFaceAck(timeout=20000) {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{if(conn.faceAck){conn.faceAck=null;reject(new Error("Het horloge bevestigde de watchface-overdracht niet."));}},timeout);
    conn.faceAck={resolve,reject,timer};
  });
}
function cancelFaceAck(error) {
  if(!conn.faceAck)return;const ack=conn.faceAck;conn.faceAck=null;clearTimeout(ack.timer);ack.reject(error);
}
async function uploadWatchFace() {
  if(!conn.device?.gatt?.connected||!conn.faceData)throw new Error("Het watchface-datakanaal is niet verbonden.");
  if(!selectedFace)throw new Error("Kies eerst een geldig .bin-watchfacebestand.");
  if(conn.battery!==null&&conn.battery>100)throw new Error("Haal het horloge van de lader, verbind opnieuw en probeer dan pas de watchface-upload.");
  if(conn.battery!==null&&conn.battery<50)throw new Error(`Batterij is ${conn.battery}%. Laad eerst op tot minimaal 50%.`);
  const bytes=selectedFace.bytes,length=bytes.length;
  const start=new Uint8Array([0xfe,0xea,0x20,0x09,0x74,(length>>>24)&255,(length>>>16)&255,(length>>>8)&255,length&255]);
  const finish=new Uint8Array([0xfe,0xea,0x20,0x09,0x74,0,0,0,0]);
  const setTransfer=new Uint8Array([0xfe,0xea,0x20,0x0a,0xb4,0x11,0x30,0x04,0,0]);
  const activateSlot6=new Uint8Array([0xfe,0xea,0x20,0x06,0x19,0x06]);
  const chunkSize=20,total=Math.ceil(length/chunkSize);
  setBusy(true);el.disconnect.disabled=true;el.faceProgress.value=0;setState(`Watchface uploaden: 0% (${length.toLocaleString("nl-NL")} bytes)…`);log(`Watchface-overdracht naar slot 6 gestart: ${selectedFace.file.name}.`);
  const ackPromise=waitForFaceAck(Math.max(60000,total*50+20000));
  try{
    await writeWithoutResponse(conn.out,start);await delay(500);
    for(let offset=0,index=0;offset<length;offset+=chunkSize,index++){
      await writeWithoutResponse(conn.faceData,bytes.slice(offset,Math.min(offset+chunkSize,length)));
      if(index%10===0||index===total-1){const percent=Math.min(99,Math.round((index+1)*100/total));el.faceProgress.value=percent;setState(`Watchface uploaden: ${percent}%…`);}
      await delay(12);
    }
    log("Alle watchfacebytes verzonden; wachten op ontvangstbevestiging.");
    await ackPromise;
    log("Ontvangstbevestiging van het horloge ontvangen.");
    await writeWithoutResponse(conn.out,finish);await delay(200);
    await writeWithoutResponse(conn.out,setTransfer);await delay(200);
    await writeWithoutResponse(conn.out,activateSlot6);
    el.faceProgress.value=100;setState("Watchface ontvangen en custom slot 6 geactiveerd.","ok");log("Watchface-upload voltooid; slot 6 geactiveerd.");
  }catch(error){
    if(conn.faceAck)cancelFaceAck(error);
    try{await ackPromise;}catch{}
    if(conn.device?.gatt?.connected){try{await writeWithoutResponse(conn.out,finish);}catch{}}
    el.faceProgress.value=0;throw error;
  }finally{setBusy(false);}
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

el.connect.addEventListener("click",()=>connect().catch(fail)); el.fetch.addEventListener("click",()=>fetchData().catch(fail)); el.syncTime.addEventListener("click",()=>syncTime().catch(fail)); el.measureHr.addEventListener("click",()=>measureHeartRate().catch(fail)); el.measureBp.addEventListener("click",()=>measureBloodPressure().catch(fail)); el.disconnect.addEventListener("click",()=>disconnect().catch(fail)); el.exportCsv.addEventListener("click",exportCsv); el.exportJson.addEventListener("click",exportJson); el.faceFile.addEventListener("change",()=>selectFaceFile().catch(fail)); el.uploadFace.addEventListener("click",()=>uploadWatchFace().catch(fail));
log(navigator.bluetooth?"Gereed. Kies eerst je Magic3/C17.":"Web Bluetooth ontbreekt; open via localhost in Chrome of Edge.",!navigator.bluetooth);
