import {buildTypeBFace,rgbaToRgb565} from "./watchface-builder.js?v=20260924-26";

const APP_VERSION = "2026.09.25-32";

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
const CMD = {
  SYNC_TIME:0x31,SLEEP:0x32,PAST:0x33,HEART:0x35,BLOOD_PRESSURE:0x69,HEART_MEASURE:0x6d,
  SET_FACE:0x19,QUERY_FACE:0x29,QUERY_FACE_COUNT:0x84,DFU_PACKAGE_LENGTH:0xba,
  SET_GOAL:0x16,QUERY_GOAL:0x26,SET_TIME_SYSTEM:0x17,QUERY_TIME_SYSTEM:0x27,
  SET_QUICK_VIEW:0x18,QUERY_QUICK_VIEW:0x28,SET_UNITS:0x1a,QUERY_UNITS:0x2a,
  SET_SEDENTARY:0x1d,QUERY_SEDENTARY:0x2d,SET_ALARM:0x11,QUERY_ALARM:0x21,
  SET_DND:0x71,QUERY_DND:0x81,SET_QUICK_TIME:0x72,QUERY_QUICK_TIME:0x82,
  SET_MOVE_PERIOD:0x73,QUERY_MOVE_PERIOD:0x83,FIND_WATCH:0x61,
};
const ARG = { YESTERDAY_STEPS:1, EARLIER_STEPS:2, YESTERDAY_SLEEP:3, EARLIER_SLEEP:4 };
const el = Object.fromEntries(["connect","chooseDevice","fetch","syncTime","measureHr","measureBp","exportCsv","exportJson","disconnect","state","vitals","activity","sleep","heart","log","faceFile","loadTypeB","uploadFace","activateCustomFace","faceIndex","faceInfo","faceProgress","faceUploadStatus","facePreview","faceTitle","faceAccent","faceBackgroundColor","faceBackgroundFile","backgroundOpacity","clockStyle","transparentParts","movePart","partX","partY","partScale","showDate","showSteps","showDistance","showHeart","showBattery","buildFace","downloadBuiltFace","builderInfo","readSettings","findWatch","settingsStatus","settingGoal","settingTimeSystem","settingUnits","saveBasics","quickViewEnabled","quickStart","quickEnd","saveQuickView","dndEnabled","dndStart","dndEnd","saveDnd","moveEnabled","movePeriod","moveSteps","moveStart","moveEnd","saveMove","alarmSlot","alarmTime","alarmEnabled","alarmDays","alarmSummary","saveAlarm"].map(id => [id, document.getElementById(id)]));
const settingButtons=[...document.querySelectorAll(".watch-setting-action")];
const appRoot=document.querySelector("main"),navButtons=[...document.querySelectorAll(".nav-button")];
const conn = { device:null, server:null, steps:null, out:null, input:null, faceData:null, frame:[], expected:0, waiters:[], faceTransfer:null, faceAbortError:null, battery:null, faceTemplate:null };
const MAX_SAFE_FACE_SIZE = 300*1024;
let dataset = freshDataset();
let selectedFace = null;
let generatedFace = null;
let customFaceBackground = null;
let rememberedDevice=null;
const REMEMBERED_DEVICE_KEY="magic3-remembered-device-id";

function freshDataset() { return { generatedAt:null, device:{}, vitals:{heartRate:[],bloodPressure:[]}, activity:[], sleep:[], heartRate:[] }; }
function log(message, error=false) { el.log.textContent += `[${new Date().toLocaleTimeString()}] ${message}\n`; el.log.scrollTop=el.log.scrollHeight; (error?console.error:console.log)(message); }
function setState(message, kind="muted") { el.state.className=kind; el.state.textContent=message; }
function setActivePage(page,scroll=true){
  if(!["overview","device","faces","more"].includes(page))page="overview";
  appRoot.dataset.activePage=page;
  navButtons.forEach(button=>{const active=button.dataset.target===page;button.classList.toggle("active",active);if(active)button.setAttribute("aria-current","page");else button.removeAttribute("aria-current");});
  if(scroll)window.scrollTo({top:0,behavior:"smooth"});
}
function delay(ms) { return new Promise(resolve => setTimeout(resolve,ms)); }
function hex(bytes) { return [...bytes].map(v=>v.toString(16).padStart(2,"0")).join(" "); }
function localDate(daysAgo=0) { const d=new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()-daysAgo); return d.toLocaleDateString("sv-SE"); }
function formatDate(iso) { return new Intl.DateTimeFormat("en-GB",{weekday:"short",day:"numeric",month:"short"}).format(new Date(`${iso}T12:00:00`)); }
function formatNumber(value) { return Number(value).toLocaleString("en-GB"); }
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
  const transfer=conn.faceTransfer;if(!transfer||transfer.mode!=="indexed")return Promise.reject(new Error("The indexed watch-face transfer is not active."));
  if(transfer.pendingRequests.length){const request=transfer.pendingRequests.shift();transfer.pendingKeys.delete(hex(request));return Promise.resolve(request);}
  return new Promise((resolve,reject)=>{const waiter={resolve,reject,timer:null};waiter.timer=setTimeout(()=>{if(transfer.waiter===waiter)transfer.waiter=null;reject(new Error("The watch did not request the next watch-face block."));},timeout);transfer.waiter=waiter;});
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
      if(offset===0&&chunkSize>20){conn.faceChunkSize=20;log(`FEE6 does not accept ${chunkSize}-byte fragments; safely falling back to 20 bytes (${error.message}).`);return sendFaceDataBlock(frame);}
      throw error;
    }
    await delay(confirmed?3:20);
  }
}
function dispatchMessage(message) {
  if(message.command===0x74&&queueFaceTransferRequest(message.payload))return;
  log(`Received 0x${message.command.toString(16).padStart(2,"0")} (${message.payload.length} bytes): ${hex(message.payload)||"no payload"}.`);
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
  if(!indexedRequest)log(`BLE notification ${source}: ${hex(bytes)||"empty"}.`);
  if(bytes.length>=5 && bytes[0]===0xfe && bytes[1]===0xea){parseFragment(bytes);return;}
}
async function monitorCharacteristic(characteristic) {
  if(!(characteristic.properties.notify||characteristic.properties.indicate))return;
  characteristic.addEventListener("characteristicvaluechanged",notificationReceived);
  await characteristic.startNotifications(); log(`Listening to BLE characteristic ${shortUuid(characteristic.uuid)}.`);
}
function awaitResponse(command,match=null,timeout=4000) {
  return new Promise((resolve,reject)=>{
    const waiter={command,match,resolve,reject,timer:null};
    waiter.timer=setTimeout(()=>{ const i=conn.waiters.indexOf(waiter); if(i>=0)conn.waiters.splice(i,1); reject(new Error(`No response to command 0x${command.toString(16)}.`)); },timeout);
    conn.waiters.push(waiter);
  });
}
async function request(command,payload=[],match=null,timeout=4000,header=0x20) {
  const response=awaitResponse(command,match,timeout); await write(packet(command,payload,header)); return response;
}

async function disconnect() {
  conn.waiters.splice(0).forEach(w=>{clearTimeout(w.timer);w.reject(new Error("Connection closed."));});
  if(conn.faceTransfer?.waiter){clearTimeout(conn.faceTransfer.waiter.timer);conn.faceTransfer.waiter.reject(new Error("Connection closed."));conn.faceTransfer.waiter=null;}
  if(conn.device?.gatt?.connected) conn.device.gatt.disconnect();
  Object.assign(conn,{server:null,steps:null,out:null,input:null,faceData:null,frame:[],expected:0,faceTransfer:null,faceAbortError:null,battery:null,faceTemplate:null});
  setConnectedControls(false); setState("Not connected.");
}
function disconnected() {
  if(conn.faceTransfer?.waiter){clearTimeout(conn.faceTransfer.waiter.timer);conn.faceTransfer.waiter.reject(new Error("Connection closed."));conn.faceTransfer.waiter=null;}
  Object.assign(conn,{server:null,steps:null,out:null,input:null,faceData:null,frame:[],expected:0,faceTransfer:null,faceAbortError:null,battery:null,faceTemplate:null});
  setConnectedControls(false); setState("Connection closed."); log("Connection closed.");
}
function setConnectedControls(connected) {
  el.connect.disabled=connected; el.fetch.disabled=!connected; el.syncTime.disabled=!connected; el.measureHr.disabled=!connected; el.measureBp.disabled=!connected; el.disconnect.disabled=!connected;
  el.chooseDevice.disabled=connected;
  settingButtons.forEach(button=>button.disabled=!connected);
  el.settingsStatus.className=connected?"muted":"muted";if(!connected)el.settingsStatus.textContent="Connect the watch first.";
  el.activateCustomFace.disabled=!connected;
  // Keep upload clickable once a face exists, so a missing connection produces a useful explanation instead of a silent disabled button.
  el.uploadFace.disabled=!selectedFace;
  if(!selectedFace){el.uploadFace.title="Build or choose a watch face first";el.faceUploadStatus.className="muted";el.faceUploadStatus.textContent="Build or choose a watch face first.";}
  else if(!connected){el.uploadFace.title="Connect the watch first";el.faceUploadStatus.className="bad";el.faceUploadStatus.textContent="Watch face ready. Click ‘Choose watch’ at the top first.";}
  else if(!conn.faceData){el.uploadFace.title="FEE6 data channel is missing";el.faceUploadStatus.className="bad";el.faceUploadStatus.textContent="Connected, but the required FEE6 watch-face channel was not found.";}
  else {el.uploadFace.title="Send watch face to the download slot";if(!/^(Complete|Upload|Transfer|Index)/.test(el.faceUploadStatus.textContent)){el.faceUploadStatus.className="ok";el.faceUploadStatus.textContent="Ready to upload. Keep this page open during the transfer.";}}
}
function setBusy(busy) {
  for(const button of [el.fetch,el.syncTime,el.measureHr,el.measureBp,el.uploadFace,el.activateCustomFace]) button.disabled=busy;
  settingButtons.forEach(button=>button.disabled=busy);
  el.faceFile.disabled=busy;el.faceIndex.disabled=busy;
  el.buildFace.disabled=busy; el.faceBackgroundFile.disabled=busy;
  if(!busy && !conn.device?.gatt?.connected) setConnectedControls(false);
  else if(!busy)setConnectedControls(true);
}
function looksLikeMagic3(device){return /c17|magic\s*3|moy/i.test(device?.name||"");}
function updateRememberedDeviceUi(){
  if(rememberedDevice){el.connect.textContent=`Connect ${rememberedDevice.name||"C17"}`;el.chooseDevice.hidden=false;}
  else {el.connect.textContent="Choose watch";el.chooseDevice.hidden=true;}
}
async function prepareRememberedDevice(){
  if(!navigator.bluetooth||typeof navigator.bluetooth.getDevices!=="function"){log("This browser cannot automatically retrieve a previously selected Bluetooth device.");updateRememberedDeviceUi();return;}
  try{
    const devices=await navigator.bluetooth.getDevices(),savedId=localStorage.getItem(REMEMBERED_DEVICE_KEY),matching=devices.filter(looksLikeMagic3);
    rememberedDevice=devices.find(device=>device.id===savedId)??(matching.length===1?matching[0]:null);
    if(rememberedDevice)log(`Previously authorised watch found: ${rememberedDevice.name||"C17"}. The next connection will not require the device chooser.`);
  }catch(error){log(`Could not retrieve the previous watch: ${error.message}`);}
  updateRememberedDeviceUi();
}
async function connect(forcePicker=false) {
  if(!navigator.bluetooth) throw new Error("Web Bluetooth is unavailable. Use Chrome or Edge on Windows.");
  await disconnect();
  let device=!forcePicker?rememberedDevice:null;
  if(device)log(`Reconnecting to remembered watch ${device.name||"C17"}; skipping the Bluetooth chooser.`);
  else {
    log("Select the Magic3/C17 in the filtered Bluetooth chooser.");
    device=await navigator.bluetooth.requestDevice({filters:[{services:[UUID.service]},{namePrefix:"C17"},{namePrefix:"c17"},{namePrefix:"Magic3"},{namePrefix:"MAGIC3"},{namePrefix:"MOY"},{namePrefix:"moy"}],optionalServices:[UUID.service,UUID.deviceInfo,UUID.batteryService]});
  }
  conn.device=device;
  conn.device.addEventListener("gattserverdisconnected",disconnected);
  conn.server=await conn.device.gatt.connect();
  const info=await conn.server.getPrimaryService(UUID.deviceInfo);
  const manufacturerValue=await (await info.getCharacteristic(UUID.manufacturer)).readValue();
  const manufacturer=new TextDecoder().decode(manufacturerValue).replace(/\0/g,"").trim();
  if(manufacturer!==EXPECTED_MANUFACTURER){ await disconnect(); throw new Error(`Device rejected: manufacturer ID is “${manufacturer}”; expected “${EXPECTED_MANUFACTURER}”.`); }
  const service=await conn.server.getPrimaryService(UUID.service);
  conn.steps=await service.getCharacteristic(UUID.steps); conn.out=await service.getCharacteristic(UUID.out); conn.input=await service.getCharacteristic(UUID.input);
  await monitorCharacteristic(conn.input);
  try{conn.faceData=await service.getCharacteristic(UUID.faceData);const p=conn.faceData.properties,modes=[p.write&&"with response",p.writeWithoutResponse&&"without response"].filter(Boolean).join(" and ")||"unknown write method";log(`Watch-face data channel FEE6 found (write ${modes}); CRP-V2 will use ${p.write?"with":"without"} response.`);}catch{conn.faceData=null;log("Watch-face data channel FEE6 is missing; upload is unavailable.",true);}
  dataset.device={name:conn.device.name||"Magic3/C17",manufacturer};
  try { const battery=await conn.server.getPrimaryService(UUID.batteryService); dataset.device.battery=(await (await battery.getCharacteristic(UUID.batteryLevel)).readValue()).getUint8(0);conn.battery=dataset.device.battery; } catch { log("Battery level is unavailable."); }
  setConnectedControls(true);
  rememberedDevice=conn.device;try{localStorage.setItem(REMEMBERED_DEVICE_KEY,conn.device.id);}catch{}updateRememberedDeviceUi();
  setState(`Connected to ${dataset.device.name}; ${manufacturer} confirmed${dataset.device.battery!==undefined?`, battery ${dataset.device.battery}%`:""}.`,"ok");
  log(`Device check passed: ${manufacturer}. Viewer ready.`);
}

function decodeActivity(data,daysAgo) {
  if(data.length!==9) throw new Error(`Unexpected activity length: ${data.length} instead of 9.`);
  return { date:localDate(daysAgo), steps:uint24le(data,0), distanceMeters:uint24le(data,3), calories:uint24le(data,6) };
}
function decodeSleep(data,daysAgo) {
  if(data.length%3!==0) throw new Error(`Unexpected sleep length: ${data.length}.`);
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
  catch(error){ log(`${label}: unavailable (${error.message})`); return null; }
}
async function fetchData() {
  if(!conn.server || !conn.device?.gatt?.connected) throw new Error("The watch is not connected.");
  setBusy(true); setState("Reading data…"); const savedVitals=dataset.vitals; dataset=freshDataset(); dataset.vitals=savedVitals; dataset.device={name:conn.device.name||"Magic3/C17",manufacturer:EXPECTED_MANUFACTURER};
  try {
    const today=new Uint8Array(await conn.steps.readValue().then(v=>new Uint8Array(v.buffer,v.byteOffset,v.byteLength))); dataset.activity.push(decodeActivity(today,0));
    for(const [arg,days,label] of [[ARG.YESTERDAY_STEPS,1,"Yesterday"],[ARG.EARLIER_STEPS,2,"Two days ago"]]){
      const payload=await optionalRequest(CMD.PAST,[arg],p=>p[0]===arg,`${label} activity`); if(payload)dataset.activity.push(decodeActivity(payload.slice(1),days)); await delay(180);
    }
    const now=new Date(), sleepOffset=now.getHours()>=20?1:0;
    const currentSleep=await optionalRequest(CMD.SLEEP,[],null,"Recent sleep"); if(currentSleep)dataset.sleep.push(decodeSleep(currentSleep,sleepOffset)); await delay(180);
    for(const [arg,days,label] of [[ARG.YESTERDAY_SLEEP,1-sleepOffset,"Previous sleep"],[ARG.EARLIER_SLEEP,2-sleepOffset,"Earlier sleep"]]){
      const payload=await optionalRequest(CMD.PAST,[arg],p=>p[0]===arg,label); if(payload)dataset.sleep.push(decodeSleep(payload.slice(1),days)); await delay(180);
    }
    // CMD 0x35 is the same two-day, five-minute history query used by Gadgetbridge.
    for(let index=0;index<8;index++){
      const payload=await optionalRequest(CMD.HEART,[index],p=>p[0]===index,`Heart-rate packet ${index+1}/8`,index===0?4500:3000);
      if(!payload) break; dataset.heartRate.push(...decodeHeart(payload)); await delay(120);
    }
    dataset.generatedAt=new Date().toISOString(); dataset.activity.sort((a,b)=>b.date.localeCompare(a.date)); dataset.sleep=dataset.sleep.filter(s=>s.stages.length).sort((a,b)=>b.date.localeCompare(a.date)); dataset.heartRate.sort((a,b)=>a.at.localeCompare(b.at));
    render(); el.exportCsv.disabled=false; el.exportJson.disabled=false;
    setState(`Read ${dataset.activity.length} activity days, ${dataset.sleep.length} sleep periods and ${dataset.heartRate.length} heart-rate measurements.`,"ok");
  } finally { setBusy(false); }
}

async function syncTime() {
  if(!conn.device?.gatt?.connected) throw new Error("The watch is not connected.");
  setBusy(true);
  try {
    const now=new Date(); await write(packet(CMD.SYNC_TIME,timePayload(now)));
    setState(`Time synchronised: ${now.toLocaleString("en-GB")}.`,"ok"); log(`Local date and time sent (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`);
  } finally { await delay(700); setBusy(false); }
}

async function measureHeartRate() {
  if(!conn.device?.gatt?.connected) throw new Error("The watch is not connected.");
  setBusy(true); setState("Measuring heart rate… Keep your arm still."); log("Current heart-rate measurement started (command 0x6d).");
  try {
    const payload=await request(CMD.HEART_MEASURE,[0],p=>p.length>=1 && p[0]>=30 && p[0]<=240,45000);
    const bpm=payload[0]; dataset.vitals.heartRate.push({at:new Date().toISOString(),bpm}); dataset.generatedAt=new Date().toISOString();
    render(); enableExports(); setState(`Current heart rate received: ${bpm} bpm.`,"ok");
  } finally {
    if(conn.device?.gatt?.connected){ try{await write(packet(CMD.HEART_MEASURE,[255]));log("Heart-rate sensor stopped.");}catch(error){log(`Could not stop the heart-rate sensor: ${error.message}`,true);} }
    setBusy(false);
  }
}

async function measureBloodPressure() {
  if(!conn.device?.gatt?.connected) throw new Error("The watch is not connected.");
  setBusy(true); setState("Experimental blood-pressure measurement in progress… Keep your arm still."); log("Blood-pressure measurement started (experimental command 0x69).");
  try {
    const payload=await request(CMD.BLOOD_PRESSURE,[0,0,0],p=>p.length>=3 && p[1]>0 && p[1]<255 && p[2]>0 && p[2]<255,45000);
    const systolic=payload[1],diastolic=payload[2]; dataset.vitals.bloodPressure.push({at:new Date().toISOString(),systolic,diastolic,unknown:payload[0]}); dataset.generatedAt=new Date().toISOString();
    render(); enableExports(); setState(`Blood-pressure response received: ${systolic}/${diastolic} mmHg. This is an unreliable watch estimate.`,"ok");
  } finally {
    if(conn.device?.gatt?.connected){ try{await write(packet(CMD.BLOOD_PRESSURE,[255,255,255]));log("Blood-pressure measurement stopped.");}catch(error){log(`Could not stop the blood-pressure measurement: ${error.message}`,true);} }
    setBusy(false);
  }
}

function requireConnected(){if(!conn.device?.gatt?.connected)throw new Error("The watch is not connected.");}
function boundedInt(input,min,max,label){const value=Math.round(Number(input.value));if(!Number.isFinite(value)||value<min||value>max)throw new Error(`${label} must be between ${min} and ${max}.`);return value;}
function parseClock(input,label){const match=/^(\d{2}):(\d{2})$/.exec(input.value);if(!match)throw new Error(`Enter a valid time for ${label}.`);const hour=Number(match[1]),minute=Number(match[2]);if(hour>23||minute>59)throw new Error(`Invalid time for ${label}.`);return {hour,minute};}
function clockText(hour,minute){return `${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}`;}
function goalFromPayload(payload){if(payload.length<4)throw new Error("The step-goal response is too short.");return (payload[0]|(payload[1]<<8)|(payload[2]<<16)|(payload[3]<<24))>>>0;}
function decodeSettingRange(payload){
  if(payload.length<4)throw new Error("The schedule response is too short.");
  const candidates=[[(payload[0]<<8)|payload[1],(payload[2]<<8)|payload[3]],[payload[0]|(payload[1]<<8),payload[2]|(payload[3]<<8)]];
  let range=candidates.find(([start,end])=>start<=1439&&end<=1439);
  if(!range&&payload[0]<=23&&payload[1]<=59&&payload[2]<=23&&payload[3]<=59)return {startH:payload[0],startM:payload[1],endH:payload[2],endM:payload[3]};
  if(!range)throw new Error(`Unknown schedule layout: ${hex(payload)}.`);
  return {startH:Math.floor(range[0]/60),startM:range[0]%60,endH:Math.floor(range[1]/60),endM:range[1]%60};
}
function decodeAlarms(payload){
  let data=payload,count;
  if(data.length%8===3){count=data[2];data=data.slice(3);}else if(data.length%8===0)count=data.length/8;else throw new Error(`Unknown ${data.length}-byte alarm layout.`);
  const names=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],result=[];
  for(let i=0;i<Math.min(count,Math.floor(data.length/8));i++){const item=data.slice(i*8,i*8+8),mask=item[7];result.push({slot:item[0],enabled:item[1]!==0,hour:item[3],minute:item[4],mask,days:names.filter((_,day)=>(mask&(1<<day))!==0)});}
  return result;
}
async function settingRequest(command,label,timeout=3500){try{return await request(command,[],null,timeout);}catch(error){log(`${label}: unavailable (${error.message})`);return null;}}
async function writeSetting(command,payload,label){await write(packet(command,payload));log(`${label} sent (0x${command.toString(16)}: ${hex(payload)||"no payload"}).`);await delay(180);}
function showSettingsStatus(message,ok=true){el.settingsStatus.className=ok?"ok":"bad";el.settingsStatus.textContent=message;}
function applyGoal(payload){const goal=goalFromPayload(payload);if(goal>=100&&goal<=1000000)el.settingGoal.value=String(goal);return `${goal.toLocaleString("en-GB")} steps`;}
function applyTimeSystem(payload){if(!payload.length)throw new Error("Empty time-format response.");el.settingTimeSystem.value=payload[0]===0?"0":"1";return payload[0]===0?"12 hour":"24 hour";}
function applyUnits(payload){if(!payload.length)throw new Error("Empty units response.");el.settingUnits.value=payload[0]===1?"1":"0";return payload[0]===1?"imperial":"metric";}
function applyQuick(payload){if(!payload.length)throw new Error("Empty raise-to-wake response.");el.quickViewEnabled.checked=payload[0]!==0;return el.quickViewEnabled.checked?"on":"off";}
function applyRange(payload,startInput,endInput){const range=decodeSettingRange(payload);startInput.value=clockText(range.startH,range.startM);endInput.value=clockText(range.endH,range.endM);return range;}
function applyMove(payload){if(payload.length<4)throw new Error("The movement-reminder response is too short.");el.movePeriod.value=String(payload[0]);el.moveSteps.value=String(payload[1]);el.moveStart.value=String(payload[2]);el.moveEnd.value=String(payload[3]);return `${payload[0]} min, ${payload[2]}–${payload[3]} hours`;}
function applyAlarms(payload){
  const alarms=decodeAlarms(payload),names=alarms.map(alarm=>`slot ${alarm.slot}: ${clockText(alarm.hour,alarm.minute)} · ${alarm.enabled?"on":"off"}${alarm.days.length?` · ${alarm.days.join("/")}`:""}`);
  el.alarmSummary.textContent=names.length?names.join(" | "):"No alarms configured.";
  const selected=alarms.find(alarm=>alarm.slot===Number(el.alarmSlot.value))??alarms[0];
  if(selected){el.alarmSlot.value=String(selected.slot);el.alarmTime.value=clockText(selected.hour,selected.minute);el.alarmEnabled.checked=selected.enabled;for(const input of el.alarmDays.querySelectorAll('input[type="checkbox"]'))input.checked=(selected.mask&(1<<Number(input.value)))!==0;}
  return `${alarms.length} alarm${alarms.length===1?"":"s"}`;
}
async function readWatchSettings(nested=false){
  requireConnected();if(!nested)setBusy(true);showSettingsStatus("Reading settings…",true);const found=[],missing=[];
  const read=async(command,label,apply)=>{const payload=await settingRequest(command,label);if(!payload){missing.push(label);return;}try{found.push(`${label}: ${apply(payload)}`);}catch(error){missing.push(label);log(`${label}: ${error.message}`,true);}};
  try{
    await read(CMD.QUERY_GOAL,"Step goal",applyGoal);await read(CMD.QUERY_TIME_SYSTEM,"Time format",applyTimeSystem);await read(CMD.QUERY_UNITS,"Units",applyUnits);
    await read(CMD.QUERY_QUICK_VIEW,"Raise to wake",applyQuick);await read(CMD.QUERY_QUICK_TIME,"Raise-to-wake schedule",payload=>{const range=applyRange(payload,el.quickStart,el.quickEnd);return `${clockText(range.startH,range.startM)}–${clockText(range.endH,range.endM)}`;});
    await read(CMD.QUERY_DND,"Do not disturb",payload=>{const range=applyRange(payload,el.dndStart,el.dndEnd);el.dndEnabled.checked=range.startH+range.startM+range.endH+range.endM!==0;return el.dndEnabled.checked?`${el.dndStart.value}–${el.dndEnd.value}`:"off";});
    await read(CMD.QUERY_SEDENTARY,"Movement reminder",payload=>{if(!payload.length)throw new Error("Empty response.");el.moveEnabled.checked=payload[0]!==0;return el.moveEnabled.checked?"on":"off";});
    await read(CMD.QUERY_MOVE_PERIOD,"Movement schedule",applyMove);await read(CMD.QUERY_ALARM,"Alarms",applyAlarms);
    const summary=found.length?found.join(" · "):"No supported settings received.";showSettingsStatus(`${summary}${missing.length?` · Unavailable: ${missing.join(", ")}`:""}`,found.length>0);log(`Settings read: ${found.join("; ")||"no responses"}.`);
  }finally{if(!nested)setBusy(false);}
}
async function saveBasics(){
  requireConnected();setBusy(true);try{const goal=boundedInt(el.settingGoal,100,100000,"Step goal"),goalBytes=[(goal>>>24)&255,(goal>>>16)&255,(goal>>>8)&255,goal&255];await writeSetting(CMD.SET_GOAL,goalBytes,"Step goal");await writeSetting(CMD.SET_TIME_SYSTEM,[Number(el.settingTimeSystem.value)],"Time format");await writeSetting(CMD.SET_UNITS,[Number(el.settingUnits.value)],"Units");const checks=[];for(const [cmd,label,apply] of [[CMD.QUERY_GOAL,"step goal",applyGoal],[CMD.QUERY_TIME_SYSTEM,"time format",applyTimeSystem],[CMD.QUERY_UNITS,"units",applyUnits]]){const payload=await settingRequest(cmd,label);if(payload)checks.push(apply(payload));}showSettingsStatus(`General settings saved${checks.length?` and read back: ${checks.join(", ")}`:"; reading them back is not supported"}.`);}
  finally{setBusy(false);}
}
async function saveQuickView(){
  requireConnected();const start=parseClock(el.quickStart,"raise-to-wake start"),end=parseClock(el.quickEnd,"raise-to-wake end");setBusy(true);try{await writeSetting(CMD.SET_QUICK_VIEW,[el.quickViewEnabled.checked?1:0],"Raise to wake");await writeSetting(CMD.SET_QUICK_TIME,[start.hour,start.minute,end.hour,end.minute],"Raise-to-wake schedule");const enabled=await settingRequest(CMD.QUERY_QUICK_VIEW,"Raise to wake"),range=await settingRequest(CMD.QUERY_QUICK_TIME,"Raise-to-wake schedule");if(enabled)applyQuick(enabled);if(range)applyRange(range,el.quickStart,el.quickEnd);showSettingsStatus(`Raise to wake saved: ${el.quickViewEnabled.checked?`${el.quickStart.value}–${el.quickEnd.value}`:"off"}.`);}finally{setBusy(false);}
}
async function saveDnd(){
  requireConnected();const start=parseClock(el.dndStart,"do-not-disturb start"),end=parseClock(el.dndEnd,"do-not-disturb end"),payload=el.dndEnabled.checked?[start.hour,start.minute,end.hour,end.minute]:[0,0,0,0];setBusy(true);try{await writeSetting(CMD.SET_DND,payload,"Do not disturb");const response=await settingRequest(CMD.QUERY_DND,"Do not disturb");if(response){const range=applyRange(response,el.dndStart,el.dndEnd);el.dndEnabled.checked=range.startH+range.startM+range.endH+range.endM!==0;}showSettingsStatus(`Do not disturb saved: ${el.dndEnabled.checked?`${el.dndStart.value}–${el.dndEnd.value}`:"off"}.`);}finally{setBusy(false);}
}
async function saveMove(){
  requireConnected();const period=boundedInt(el.movePeriod,10,180,"Number of minutes"),steps=boundedInt(el.moveSteps,0,255,"Number of steps"),start=boundedInt(el.moveStart,0,23,"Start hour"),end=boundedInt(el.moveEnd,0,23,"End hour");setBusy(true);try{await writeSetting(CMD.SET_SEDENTARY,[el.moveEnabled.checked?1:0],"Movement reminder");await writeSetting(CMD.SET_MOVE_PERIOD,[period,steps,start,end],"Movement schedule");const enabled=await settingRequest(CMD.QUERY_SEDENTARY,"Movement reminder"),range=await settingRequest(CMD.QUERY_MOVE_PERIOD,"Movement schedule");if(enabled)el.moveEnabled.checked=enabled[0]!==0;if(range)applyMove(range);showSettingsStatus(`Movement reminder saved: ${el.moveEnabled.checked?`${el.movePeriod.value} minutes, ${el.moveStart.value}–${el.moveEnd.value} hours`:"off"}.`);}finally{setBusy(false);}
}
async function saveAlarm(){
  requireConnected();const slot=boundedInt(el.alarmSlot,0,7,"Alarm slot"),time=parseClock(el.alarmTime,"alarm"),days=[...el.alarmDays.querySelectorAll('input[type="checkbox"]:checked')].map(input=>Number(input.value));if(el.alarmEnabled.checked&&!days.length)throw new Error("Select at least one repeat day, or disable the alarm.");const mask=days.reduce((value,day)=>value|(1<<day),0),repeat=mask===0x7f?1:mask?2:0,payload=[slot,el.alarmEnabled.checked?1:0,repeat,time.hour,time.minute,0,0,mask];setBusy(true);try{await writeSetting(CMD.SET_ALARM,payload,"Alarm");const response=await settingRequest(CMD.QUERY_ALARM,"Alarms",4500);if(response)applyAlarms(response);showSettingsStatus(`Alarm in slot ${slot} saved: ${el.alarmEnabled.checked?`${el.alarmTime.value} (${days.length} days)`:"off"}.`);}finally{setBusy(false);}
}
async function findWatch(){requireConnected();setBusy(true);try{await writeSetting(CMD.FIND_WATCH,[],"Find my watch");showSettingsStatus("Search signal sent; the watch should now vibrate or make a sound.");}finally{await delay(500);setBusy(false);}}

const FACE_LAYOUT = {panel:"#0b1627",big:{width:42,height:64},small:{width:14,height:22}};
const editorParts = {
  time:{x:12,y:36,width:216,height:92,scale:1},date:{x:12,y:142,width:94,height:41,scale:1},
  steps:{x:12,y:191,width:104,height:38,scale:1},distance:{x:122,y:191,width:106,height:38,scale:1},
  heart:{x:12,y:234,width:142,height:34,scale:1},battery:{x:164,y:142,width:64,height:41,scale:1},
};
let draggedPart=null,dragOffset={x:0,y:0};

function partBounds(key){
  const part=editorParts[key];
  if(key==="time"&&el.clockStyle.value==="binary")return {x:part.x,y:part.y,width:part.width,height:part.height*part.scale};
  return {x:part.x,y:part.y,width:part.width*part.scale,height:part.height*part.scale};
}
function partScaleMaximum(key){
  const part=editorParts[key];
  if(key==="time"&&el.clockStyle.value==="binary")return Math.floor(Math.min(1.5,(280-part.y)/part.height)*100);
  return Math.floor(Math.min(1.5,240/part.width,280/part.height)*100);
}
function drawScaledPart(context,part,draw){context.save();context.translate(part.x,part.y);context.scale(part.scale,part.scale);draw();context.restore();}

function roundedRect(context,x,y,width,height,radius,fill) {
  context.beginPath(); context.roundRect(x,y,width,height,radius); context.fillStyle=fill; context.fill();
}
function drawCover(context,image,width,height) {
  const scale=Math.max(width/image.width,height/image.height),drawWidth=image.width*scale,drawHeight=image.height*scale;
  context.drawImage(image,(width-drawWidth)/2,(height-drawHeight)/2,drawWidth,drawHeight);
}
function faceOptions() {
  return {title:el.faceTitle.value.trim()||"MAGIC 3",accent:el.faceAccent.value,background:el.faceBackgroundColor.value,imageOpacity:Math.max(0,Math.min(1,Number(el.backgroundOpacity.value)/100)),clockStyle:el.clockStyle.value,transparent:el.transparentParts.checked,date:el.showDate.checked,steps:el.showSteps.checked,distance:el.showDistance.checked,heart:el.showHeart.checked,battery:el.showBattery.checked};
}
function timeDigitPositions(style="digital"){
  const p=editorParts.time,s=p.scale;
  if(style==="binary"){
    const size=Math.round(16*s),left=p.x+48-size/2,firstY=p.y+18;
    return [0,1,2,3].map(row=>[left,firstY+row*18*s]);
  }
  return [[12,14],[54,14],[120,14],[162,14]].map(([x,y])=>[p.x+x*s,p.y+y*s]);
}
function analogGeometry(){const p=editorParts.time,s=p.scale;return {cx:p.x+p.width*s/2,cy:p.y+p.height*s/2,radius:34*s};}
function fieldPositions(){
  const date=editorParts.date,steps=editorParts.steps,distance=editorParts.distance,heart=editorParts.heart,battery=editorParts.battery;
  return {day:[date.x+8*date.scale,date.y+15*date.scale,date.scale],month:[date.x+48*date.scale,date.y+15*date.scale,date.scale],steps:[steps.x+43*steps.scale,steps.y+8*steps.scale,steps.scale],distance:[distance.x+36*distance.scale,distance.y+8*distance.scale,distance.scale],distanceUnit:[distance.x+83*distance.scale,distance.y+14*distance.scale,distance.scale],heart:[heart.x+60*heart.scale,heart.y+4*heart.scale,heart.scale],battery:[battery.x+21*battery.scale,battery.y+15*battery.scale,battery.scale]};
}
function drawFaceBase(context,options) {
  context.clearRect(0,0,240,280);
  const gradient=context.createLinearGradient(0,0,0,280);gradient.addColorStop(0,options.background);gradient.addColorStop(1,"#102d4d");context.fillStyle=gradient;context.fillRect(0,0,240,280);
  if(customFaceBackground&&options.imageOpacity>0){context.save();context.globalAlpha=options.imageOpacity;drawCover(context,customFaceBackground,240,280);context.fillStyle="rgba(0,0,0,.28)";context.fillRect(0,0,240,280);context.restore();}
  context.textBaseline="middle"; context.fillStyle=options.accent;context.font="700 12px Arial,sans-serif";context.fillText(options.title.slice(0,12).toUpperCase(),16,20);
  const time=editorParts.time,date=editorParts.date,battery=editorParts.battery,steps=editorParts.steps,distance=editorParts.distance,heart=editorParts.heart;
  if(options.clockStyle==="binary"){
    const bounds=partBounds("time");if(!options.transparent)roundedRect(context,time.x+32,bounds.y,152,bounds.height,12,FACE_LAYOUT.panel);
    context.fillStyle=options.accent;context.font=`700 ${Math.round(10*Math.min(time.scale,1.25))}px Arial,sans-serif`;context.textAlign="center";["8","4","2","1"].forEach((label,index)=>context.fillText(label,time.x+48+index*40,time.y+9));context.textAlign="left";
  }else drawScaledPart(context,time,()=>{if(!options.transparent)roundedRect(context,0,0,time.width,time.height,14,FACE_LAYOUT.panel);if(options.clockStyle==="digital"){context.fillStyle=options.accent;context.font="700 42px Arial,sans-serif";context.textAlign="center";context.fillText(":",108,45);context.textAlign="left";}else{const cx=time.width/2,cy=time.height/2,radius=34;context.save();context.strokeStyle=options.accent;context.lineCap="round";for(let mark=0;mark<12;mark++){const angle=mark*Math.PI/6-Math.PI/2,outer=radius,inner=radius-(mark%3===0?6:3);context.globalAlpha=mark%3===0?.9:.5;context.lineWidth=mark%3===0?2:1;context.beginPath();context.moveTo(cx+Math.cos(angle)*inner,cy+Math.sin(angle)*inner);context.lineTo(cx+Math.cos(angle)*outer,cy+Math.sin(angle)*outer);context.stroke();}context.restore();}});
  if(options.date)drawScaledPart(context,date,()=>{if(!options.transparent)roundedRect(context,0,0,date.width,date.height,9,FACE_LAYOUT.panel);context.fillStyle=options.accent;context.font="700 8px Arial,sans-serif";context.fillText("DATE",7,9);context.font="700 16px Arial,sans-serif";context.fillText("/",39,27);});
  if(options.battery)drawScaledPart(context,battery,()=>{if(!options.transparent)roundedRect(context,0,0,battery.width,battery.height,9,FACE_LAYOUT.panel);context.fillStyle=options.accent;context.font="700 8px Arial,sans-serif";context.fillText("BAT",7,9);context.fillText("%",54,28);});
  if(options.steps)drawScaledPart(context,steps,()=>{if(!options.transparent)roundedRect(context,0,0,steps.width,steps.height,9,FACE_LAYOUT.panel);context.fillStyle=options.accent;context.font="700 9px Arial,sans-serif";context.fillText("STEPS",8,19);});
  if(options.distance)drawScaledPart(context,distance,()=>{if(!options.transparent)roundedRect(context,0,0,distance.width,distance.height,9,FACE_LAYOUT.panel);context.fillStyle=options.accent;context.font="700 8px Arial,sans-serif";context.fillText("DIST",7,9);});
  if(options.heart)drawScaledPart(context,heart,()=>{if(!options.transparent)roundedRect(context,0,0,heart.width,heart.height,9,FACE_LAYOUT.panel);context.fillStyle=options.accent;context.font="700 9px Arial,sans-serif";context.fillText("HEART",8,17);context.fillText("BPM",110,17);});
}
function drawExampleDigits(context,options) {
  context.textAlign="center";context.textBaseline="middle";context.fillStyle=options.accent;
  if(options.clockStyle==="analog")drawAnalogHands(context,10,9,options.accent);
  else [1,0,0,9].forEach((digit,index)=>{const [x,y]=timeDigitPositions(options.clockStyle)[index];drawTimeGlyph(context,digit,x,y,options.accent,options.clockStyle,editorParts.time.scale);});
  const draw=(text,x,y,scale=1)=>{context.font=`700 ${Math.round(18*scale)}px Arial,sans-serif`;[...text].forEach((digit,index)=>context.fillText(digit,x+(index*14+7)*scale,y+11*scale));};
  const positions=fieldPositions();
  if(options.date){draw("19",...positions.day);draw("09",...positions.month);}
  if(options.battery)draw("82",...positions.battery);
  if(options.steps)draw("8240",...positions.steps);
  if(options.distance){const metric=el.settingUnits.value!=="1";draw(metric?"8.2":"5.1",...positions.distance);context.font=`700 ${Math.round(9*editorParts.distance.scale)}px Arial,sans-serif`;context.fillText(metric?"KM":"MI",positions.distanceUnit[0]+8*editorParts.distance.scale,positions.distanceUnit[1]+5*editorParts.distance.scale);}
  if(options.heart)draw("68",...positions.heart);
  context.textAlign="left";
}
function drawAnalogHands(context,hour,minute,foreground) {
  const scale=editorParts.time.scale,{cx,cy}=analogGeometry(),drawHand=(angle,length,width)=>{context.save();context.translate(cx,cy);context.rotate(angle);context.strokeStyle=foreground;context.lineWidth=width*scale;context.lineCap="round";context.beginPath();context.moveTo(0,3*scale);context.lineTo(0,-length*scale);context.stroke();context.restore();};
  drawHand((hour%12+minute/60)*Math.PI/6,25,5);drawHand(minute*Math.PI/30,36,3);context.fillStyle=foreground;context.beginPath();context.arc(cx,cy,5*scale,0,Math.PI*2);context.fill();
}
function renderFacePreview() {
  const context=el.facePreview.getContext("2d",{alpha:false}),options=faceOptions();drawFaceBase(context,options);drawExampleDigits(context,options);
  const selected=partBounds(el.movePart.value);context.save();context.strokeStyle="#ffffff";context.setLineDash([4,3]);context.lineWidth=1;context.strokeRect(selected.x+.5,selected.y+.5,selected.width-1,selected.height-1);context.restore();
}
function editorChanged(){if(generatedFace&&selectedFace?.bytes===generatedFace.bytes)selectedFace=null;generatedFace=null;el.downloadBuiltFace.disabled=true;el.builderInfo.className="muted";el.builderInfo.textContent="Preview changed. Click ‘Build watch face’ to create the new .bin file.";renderFacePreview();setConnectedControls(Boolean(conn.device?.gatt?.connected));}
function canvasRgb565(canvas) {
  const context=canvas.getContext("2d",{willReadFrequently:true});return rgbaToRgb565(context.getImageData(0,0,canvas.width,canvas.height));
}
function drawTimeGlyph(context,digit,x,y,foreground,style,scale=1) {
  if(style!=="binary"){context.fillStyle=foreground;context.font=`700 ${Math.round(54*scale)}px Arial,sans-serif`;context.textAlign="center";context.textBaseline="middle";context.fillText(String(digit),x+21*scale,y+32*scale);return;}
  context.save();context.strokeStyle=foreground;context.fillStyle=foreground;context.lineWidth=2;
  const size=16*scale;[8,4,2,1].forEach((value,column)=>{context.beginPath();context.arc(x+size/2+column*40,y+size/2,7*scale,0,Math.PI*2);if(digit&value)context.fill();else{context.globalAlpha=.38;context.stroke();context.globalAlpha=1;}});context.restore();
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
function binaryBitBlobs(bitValue,foreground,backgroundCanvas,x,y,scale=1) {
  const variants=[];
  for(const active of [false,true]){
    const size=Math.round(16*scale),canvas=document.createElement("canvas");canvas.width=size;canvas.height=size;const context=canvas.getContext("2d",{alpha:false});
    if(backgroundCanvas)context.drawImage(backgroundCanvas,x,y,size,size,0,0,size,size);else{context.fillStyle=FACE_LAYOUT.panel;context.fillRect(0,0,size,size);}
    context.save();context.strokeStyle=foreground;context.fillStyle=foreground;context.lineWidth=Math.max(2,Math.round(2*scale));context.beginPath();context.arc(size/2,size/2,7*scale,0,Math.PI*2);
    if(active)context.fill();else{context.globalAlpha=.38;context.stroke();}
    context.restore();variants.push(canvasRgb565(canvas));
  }
  return Array.from({length:10},(_,digit)=>variants[digit&bitValue?1:0]);
}
function clampEditorScales(){
  for(const key of Object.keys(editorParts)){
    const part=editorParts[key],maximum=partScaleMaximum(key)/100;
    if(part.scale>maximum)part.scale=maximum;
    const bounds=partBounds(key);
    part.x=Math.max(0,Math.min(240-bounds.width,part.x));
    part.y=Math.max(0,Math.min(280-bounds.height,part.y));
  }
}
function analogHandBlob(width,height,foreground,lineWidth) {
  const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;const context=canvas.getContext("2d",{alpha:false});context.fillStyle="#000";context.fillRect(0,0,width,height);context.strokeStyle=foreground;context.lineWidth=lineWidth;context.lineCap="round";context.beginPath();context.moveTo(width/2,height-1);context.lineTo(width/2,3);context.stroke();return canvasRgb565(canvas);
}
function analogPinBlob(foreground,size=12) {
  const canvas=document.createElement("canvas");canvas.width=size;canvas.height=size;const context=canvas.getContext("2d",{alpha:false});context.fillStyle="#000";context.fillRect(0,0,size,size);context.fillStyle=foreground;context.beginPath();context.arc(size/2,size/2,size*5/12,0,Math.PI*2);context.fill();return canvasRgb565(canvas);
}
function unitBlob(text,width,height,foreground,backgroundCanvas,x,y) {
  const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;const context=canvas.getContext("2d",{alpha:false});
  if(backgroundCanvas)context.drawImage(backgroundCanvas,x,y,width,height,0,0,width,height);else{context.fillStyle=FACE_LAYOUT.panel;context.fillRect(0,0,width,height);}
  context.fillStyle=foreground;context.font=`700 ${Math.max(8,Math.round(height*.65))}px Arial,sans-serif`;context.textAlign="center";context.textBaseline="middle";context.fillText(text,width/2,height/2);return canvasRgb565(canvas);
}
function decimalPointBlob(width,height,foreground,backgroundCanvas,x,y) {
  const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;const context=canvas.getContext("2d",{alpha:false});
  if(backgroundCanvas)context.drawImage(backgroundCanvas,x,y,width,height,0,0,width,height);else{context.fillStyle=FACE_LAYOUT.panel;context.fillRect(0,0,width,height);}
  const dotX=Math.max(1,Math.round(width/8)),dotY=Math.round(height*19/24),dotWidth=Math.max(3,Math.round(width*5/8)),dotHeight=Math.max(3,height-dotY);context.fillStyle=foreground;context.fillRect(dotX,dotY,dotWidth,dotHeight);return canvasRgb565(canvas);
}
function makeWatchFace() {
  clampEditorScales();syncPositionControls();
  const options=faceOptions(),base=document.createElement("canvas");base.width=240;base.height=280;const baseContext=base.getContext("2d",{alpha:false});drawFaceBase(baseContext,options);
  const preview=document.createElement("canvas");preview.width=240;preview.height=280;const previewContext=preview.getContext("2d",{alpha:false});previewContext.drawImage(base,0,0);drawExampleDigits(previewContext,options);
  const thumbnail=document.createElement("canvas");thumbnail.width=140;thumbnail.height=163;thumbnail.getContext("2d",{alpha:false}).drawImage(preview,0,0,140,163);
  const blobs=[canvasRgb565(base)],addDigitSet=(width,height,font,x,y,style="digital")=>{const index=blobs.length;blobs.push(...digitBlobs(width,height,font,options.accent,options.transparent?base:null,x,y,style));return index;};
  const entries=[{type:0x01,imageIndex:0,x:0,y:0,width:240,height:280}];
  let sharedBig=null;const smallSets=new Map(),binarySets=new Map();
  if(options.clockStyle==="binary"){
    const scale=editorParts.time.scale,size=Math.round(16*scale);
    timeDigitPositions("binary").forEach(([rowX,rowY],row)=>{
      [8,4,2,1].forEach((bitValue,column)=>{
        const x=Math.round(rowX+column*40),y=Math.round(rowY),key=String(bitValue);let imageIndex=binarySets.get(key);
        if(imageIndex===undefined||options.transparent){imageIndex=blobs.length;blobs.push(...binaryBitBlobs(bitValue,options.accent,options.transparent?base:null,x,y,scale));if(!options.transparent)binarySets.set(key,imageIndex);}
        entries.push({type:[0x40,0x41,0x43,0x44][row],imageIndex,x,y,width:size,height:size});
      });
    });
  }else if(options.clockStyle==="analog"){
    const scale=editorParts.time.scale,{cx,cy}=analogGeometry(),hourWidth=Math.round(14*scale),hourHeight=Math.round(30*scale),hourIndex=blobs.length;blobs.push(analogHandBlob(hourWidth,hourHeight,options.accent,Math.max(2,Math.round(5*scale))));entries.push({type:0xf1,imageIndex:hourIndex,x:Math.round(cx-hourWidth/2),y:Math.round(cy-hourHeight),width:hourWidth,height:hourHeight});
    const minuteWidth=Math.round(10*scale),minuteHeight=Math.round(40*scale),minuteIndex=blobs.length;blobs.push(analogHandBlob(minuteWidth,minuteHeight,options.accent,Math.max(2,Math.round(3*scale))));entries.push({type:0xf2,imageIndex:minuteIndex,x:Math.round(cx-minuteWidth/2),y:Math.round(cy-minuteHeight),width:minuteWidth,height:minuteHeight});
    const pinSize=Math.round(12*scale),pinIndex=blobs.length;blobs.push(analogPinBlob(options.accent,pinSize));entries.push({type:0xf4,imageIndex:pinIndex,x:Math.round(cx-pinSize/2),y:Math.round(cy-pinSize/2),width:pinSize,height:pinSize});
  }else{
    const scale=editorParts.time.scale,width=Math.round(42*scale),height=Math.round(64*scale);timeDigitPositions("digital").forEach(([x,y],index)=>{x=Math.round(x);y=Math.round(y);const imageIndex=sharedBig??=addDigitSet(width,height,`700 ${Math.round(54*scale)}px Arial,sans-serif`,x,y);entries.push({type:[0x40,0x41,0x43,0x44][index],imageIndex,x,y,width,height});});
  }
  const positions=fieldPositions(),smallIndex=(x,y,scale)=>{const width=Math.round(12*scale),height=Math.round(20*scale),key=`${width}x${height}`;let index=smallSets.get(key);if(index===undefined){index=addDigitSet(width,height,`700 ${Math.round(17*scale)}px Arial,sans-serif`,Math.round(x),Math.round(y));smallSets.set(key,index);}return {index,width,height,x:Math.round(x),y:Math.round(y)};};
  if(options.date){const day=smallIndex(...positions.day),month=smallIndex(...positions.month);entries.push({type:0x30,imageIndex:day.index,x:day.x,y:day.y,width:day.width,height:day.height},{type:0x11,imageIndex:month.index,x:month.x,y:month.y,width:month.width,height:month.height});}
  if(options.steps){const item=smallIndex(...positions.steps);entries.push({type:0x62,imageIndex:item.index,x:item.x,y:item.y,width:item.width,height:item.height});}
  if(options.distance){const [distanceX,distanceY,distanceScale]=positions.distance,digitWidth=Math.max(2,Math.round(6*distanceScale)*2),digitHeight=Math.round(20*distanceScale),distanceIndex=blobs.length,roundedX=Math.round(distanceX),roundedY=Math.round(distanceY);blobs.push(...digitBlobs(digitWidth,digitHeight,`700 ${Math.round(17*distanceScale)}px Arial,sans-serif`,options.accent,options.transparent?base:null,roundedX,roundedY));const pointWidth=digitWidth/2;blobs.push(decimalPointBlob(pointWidth,digitHeight,options.accent,options.transparent?base:null,roundedX,roundedY));const unitScale=editorParts.distance.scale,unitWidth=Math.round(20*unitScale),unitHeight=Math.round(14*unitScale),unitX=Math.round(positions.distanceUnit[0]),unitY=Math.round(positions.distanceUnit[1]),kmIndex=blobs.length;blobs.push(unitBlob("KM",unitWidth,unitHeight,options.accent,options.transparent?base:null,unitX,unitY));const miIndex=blobs.length;blobs.push(unitBlob("MI",unitWidth,unitHeight,options.accent,options.transparent?base:null,unitX,unitY));entries.push({type:0xa2,imageIndex:distanceIndex,x:roundedX,y:roundedY,width:digitWidth,height:digitHeight},{type:0xa5,imageIndex:kmIndex,x:unitX,y:unitY,width:unitWidth,height:unitHeight},{type:0xa6,imageIndex:miIndex,x:unitX,y:unitY,width:unitWidth,height:unitHeight});}
  if(options.heart){const item=smallIndex(...positions.heart);entries.push({type:0x65,imageIndex:item.index,x:item.x,y:item.y,width:item.width,height:item.height});}
  if(options.battery){const item=smallIndex(...positions.battery);entries.push({type:0xd2,imageIndex:item.index,x:item.x,y:item.y,width:item.width,height:item.height});}
  blobs.push(canvasRgb565(thumbnail));
  const faceNumber=50000+(Date.now()%10000),bytes=buildTypeBFace({entries,blobs,faceNumber}),name=`magic3-custom-${faceNumber}.bin`,meta=inspectFace(bytes);
  generatedFace={name,bytes};selectedFace={file:{name,size:bytes.length},bytes,meta};el.faceProgress.value=0;el.downloadBuiltFace.disabled=false;
  el.faceInfo.className=bytes.length<=MAX_SAFE_FACE_SIZE?"ok":"bad";el.faceInfo.textContent=`${name} · ${(bytes.length/1024).toLocaleString("en-GB",{maximumFractionDigits:1})} kB · Type B/0x81 · template 34 · ${meta.dataCount} fields${bytes.length>MAX_SAFE_FACE_SIZE?" · too large for a safe MOY-NBA5 upload":""}`;
  const styleName=options.clockStyle==="binary"?"Binary BCD watch face":options.clockStyle==="analog"?"Analogue watch face":"Watch face";
  el.builderInfo.className="ok";el.builderInfo.textContent=`${styleName} built and selected${options.transparent&&options.clockStyle!=="analog"?" with the background baked behind the digits":""}. You can download or upload it directly.`;
  log(`Custom watch face built: ${name}, ${bytes.length} bytes, ${entries.length} fields and ${blobs.length} images.`);setConnectedControls(Boolean(conn.device?.gatt?.connected));
}
function syncPositionControls(){const key=el.movePart.value,part=editorParts[key],maximum=partScaleMaximum(key);el.partScale.max=maximum;el.partScale.value=Math.round(part.scale*100);el.partX.value=part.x;el.partY.value=part.y;renderFacePreview();}
function setPartPosition(x,y){const key=el.movePart.value,part=editorParts[key],bounds=partBounds(key);if(!Number.isFinite(x))x=part.x;if(!Number.isFinite(y))y=part.y;part.x=Math.max(0,Math.min(240-bounds.width,Math.round(x)));part.y=Math.max(0,Math.min(280-bounds.height,Math.round(y)));el.partX.value=part.x;el.partY.value=part.y;editorChanged();}
function setPartScale(percent){const key=el.movePart.value,part=editorParts[key],maximum=partScaleMaximum(key),value=Math.max(50,Math.min(maximum,Math.round(Number(percent)||100)));part.scale=value/100;const bounds=partBounds(key);part.x=Math.max(0,Math.min(240-bounds.width,part.x));part.y=Math.max(0,Math.min(280-bounds.height,part.y));el.partScale.max=maximum;el.partScale.value=value;el.partX.value=Math.round(part.x);el.partY.value=Math.round(part.y);editorChanged();}
function scaleModeChanged(){clampEditorScales();syncPositionControls();editorChanged();}
function previewPoint(event){const rect=el.facePreview.getBoundingClientRect();return {x:(event.clientX-rect.left)*240/rect.width,y:(event.clientY-rect.top)*280/rect.height};}
function startPartDrag(event){const point=previewPoint(event),keys=Object.keys(editorParts).reverse(),key=keys.find(name=>{const p=partBounds(name);return point.x>=p.x&&point.x<=p.x+p.width&&point.y>=p.y&&point.y<=p.y+p.height;});if(!key)return;el.movePart.value=key;draggedPart=key;dragOffset={x:point.x-editorParts[key].x,y:point.y-editorParts[key].y};el.facePreview.setPointerCapture(event.pointerId);syncPositionControls();}
function movePartDrag(event){if(!draggedPart)return;const point=previewPoint(event);setPartPosition(point.x-dragOffset.x,point.y-dragOffset.y);}
function endPartDrag(event){if(!draggedPart)return;draggedPart=null;if(el.facePreview.hasPointerCapture(event.pointerId))el.facePreview.releasePointerCapture(event.pointerId);}
async function loadFaceBackground() {
  const file=el.faceBackgroundFile.files?.[0];
  if(customFaceBackground?.close)customFaceBackground.close();customFaceBackground=null;
  if(file){if(file.size>10*1024*1024)throw new Error("The background image may be no larger than 10 MB.");customFaceBackground=await createImageBitmap(file);}
  editorChanged();
}

function inspectFace(bytes) {
  if(bytes.length<5)throw new Error("The file is too small to be a watch face.");
  if(bytes.length>4*1024*1024)throw new Error("The watch-face file exceeds the safe 4 MB limit.");
  const fileId=bytes[0],dataCount=bytes[1],blobCount=bytes[2],faceNumber=bytes[3]|(bytes[4]<<8);
  let type,maxEntries,entrySize;
  if(fileId===0x04){type="A";maxEntries=32;entrySize=6;}
  else if(fileId===0x81||fileId===0x84){type="B/C";maxEntries=39;entrySize=10;}
  else throw new Error(`Unknown MoYoung watch-face format 0x${fileId.toString(16).padStart(2,"0")}; expected 0x04, 0x81 or 0x84.`);
  if(dataCount>maxEntries)throw new Error(`Invalid number of watch-face fields: ${dataCount}.`);
  if(bytes.length<5+dataCount*entrySize)throw new Error("The watch-face header is truncated.");
  if(type==="B/C"&&bytes.length>=1900&&blobCount>0&&400+(blobCount-1)*4+4<=bytes.length){
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),lastOffset=view.getUint32(400+(blobCount-1)*4,true);
    type=1900+lastOffset>bytes.length?"B":"C";
  }
  return {fileId,type,dataCount,blobCount,faceNumber};
}
async function selectFaceFile() {
  selectedFace=null;el.faceProgress.value=0;
  const file=el.faceFile.files?.[0];
  if(!file){el.faceInfo.className="muted";el.faceInfo.textContent="No watch-face file selected.";setConnectedControls(Boolean(conn.device?.gatt?.connected));return;}
  try{
    if(!file.name.toLowerCase().endsWith(".bin"))throw new Error("Choose a watch-face file with the .bin extension.");
    const bytes=new Uint8Array(await file.arrayBuffer()),meta=inspectFace(bytes);selectedFace={file,bytes,meta};
    el.faceInfo.className="ok";el.faceInfo.textContent=`${file.name} · ${(file.size/1024).toLocaleString("en-GB",{maximumFractionDigits:1})} kB · type ${meta.type} · face ${meta.faceNumber} · ${meta.dataCount} fields`;
    log(`Watch face checked: ${file.name}, file ID 0x${meta.fileId.toString(16)}, ${file.size} bytes.`);
  }catch(error){el.faceInfo.className="bad";el.faceInfo.textContent=error.message;log(`Watch face rejected: ${error.message}`,true);}
  setConnectedControls(Boolean(conn.device?.gatt?.connected));
}
async function loadTypeBSample() {
  const response=await fetch("assets/template34-3056-color-impression.bin",{cache:"no-store"});
  if(!response.ok)throw new Error(`The included Type-B watch face could not be loaded (HTTP ${response.status}).`);
  const bytes=new Uint8Array(await response.arrayBuffer()),meta=inspectFace(bytes);
  if(meta.type!=="B"||meta.faceNumber!==3056)throw new Error(`The test watch face has an unexpected format: type ${meta.type}, face ${meta.faceNumber}.`);
  const file={name:"template34-3056-color-impression.bin",size:bytes.length};
  selectedFace={file,bytes,meta};el.faceFile.value="";el.faceProgress.value=0;
  el.faceInfo.className="ok";el.faceInfo.textContent=`${file.name} · ${(bytes.length/1024).toLocaleString("en-GB",{maximumFractionDigits:1})} kB · official Type B · face 3056 · template 34`;
  el.faceUploadStatus.className="ok";el.faceUploadStatus.textContent="Official Type-B test watch face loaded. Connect the watch; after installation, the added sixth watch face will be selected.";
  log(`Official Da Fit Type-B watch face loaded: ${file.name}, ${bytes.length} bytes.`);setConnectedControls(Boolean(conn.device?.gatt?.connected));
}
async function queryFaceState(label="Watch-face status") {
  let count=null,current=null;
  try{const payload=await request(CMD.QUERY_FACE_COUNT,[],null,4500);const profile=payload.length?payload[payload.length-1]:null;if(payload.length===3&&profile===0x22){conn.faceTemplate=profile;log(`${label}: MOY-NBA5 response ${hex(payload)} ends with profile 0x22 (template 34, 240×280 Type B).`);}else if(payload.length>=2){const candidate=(payload[0]<<8)|payload[1];if(candidate>=1&&candidate<=32)count=candidate;else log(`${label}: 0x84 payload ${hex(payload)} is not a valid list length on this firmware and will be ignored.`);}else log(`${label}: count response was too short.`,true);}catch(error){log(`${label}: count unavailable (${error.message})`);}
  await delay(120);
  try{const payload=await request(CMD.QUERY_FACE,[],null,4500);if(payload.length)current=payload[0];else log(`${label}: active-index response was empty.`,true);}catch(error){log(`${label}: active index unavailable (${error.message})`);}
  log(`${label}: count=${count??"unknown"}, active=${current??"unknown"}.`);return {count,current};
}
function selectedDisplayFace(){const value=Math.round(Number(el.faceIndex.value));if(!Number.isFinite(value)||value<1||value>6)throw new Error("Choose a watch-face index from 1 through 6.");return value;}
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
  let verified=null;try{const payload=await request(CMD.QUERY_FACE,[],null,4500);if(payload.length)verified=payload[0];}catch(error){log(`Could not read back the active watch face: ${error.message}`);}
  return verified;
}
async function queryDfuPackageLength() {
  // Da Fit sends BA 01. Its parser expects response payload [01, low, high]
  // and then replaces the file manager's packet length with that value.
  const payload=await request(CMD.DFU_PACKAGE_LENGTH,[1],data=>data.length>=3&&data[0]===1,4500);
  const length=(payload[2]<<8)|payload[1];
  if(length<20||length>512)throw new Error(`Invalid CRP packet length ${length} in response ${hex(payload)}.`);
  return {length,payload};
}
async function activateLatestFace() {
  if(!conn.device?.gatt?.connected)throw new Error("Connect the watch first.");setBusy(true);el.faceUploadStatus.className="muted";el.faceUploadStatus.textContent="Requesting watch-face list…";
  try{const target=selectedDisplayFace();await queryFaceState("Before manual activation");const verified=await setAndVerifyFace(target);if(verified!==null&&verified!==target)throw new Error(`The watch kept index ${verified} active instead of ${target}.`);el.faceUploadStatus.className="ok";el.faceUploadStatus.textContent=`Index ${target} selected${verified===target?" and confirmed by the watch":"; reading it back is not supported"}. Check the display.`;log(`Watch-face index ${target} selected; read back=${verified??"unknown"}.`);}finally{setBusy(false);}
}
async function uploadWatchFace() {
  if(!selectedFace)throw new Error("Choose a valid .bin watch-face file first.");
  if(!conn.device?.gatt?.connected)throw new Error("Connect the watch using ‘Choose watch’ at the top of the page first.");
  if(!conn.faceData)throw new Error("The watch is connected, but characteristic FEE6 for watch-face data is missing.");
  if(selectedFace.bytes.length>MAX_SAFE_FACE_SIZE)throw new Error(`This watch face is ${(selectedFace.bytes.length/1024).toLocaleString("en-GB",{maximumFractionDigits:1})} kB. For safety, the MOY-NBA5 limit is 300 kB.`);
  if(conn.battery!==null&&conn.battery>100)throw new Error("Remove the watch from its charger, reconnect it, and only then retry the watch-face upload.");
  if(conn.battery!==null&&conn.battery<50)throw new Error(`Battery is ${conn.battery}%. Charge it to at least 50% first.`);
  const before=await queryFaceState("Compatibility check");
  if(conn.faceTemplate===0x22&&selectedFace.meta.type==="C")throw new Error("This watch reports template 34 (Type B), but this file is Type C. The transfer can be acknowledged, but the firmware will not install or display the watch face. Use an original Type-B watch face for MOY-NBA5/template 34.");
  const bytes=selectedFace.bytes,length=bytes.length;
  let blockSize;
  try{const negotiated=await queryDfuPackageLength();blockSize=negotiated.length;log(`Watch reports CRP file-block size ${blockSize} bytes through 0xBA (payload ${hex(negotiated.payload)}).`);}
  catch(error){blockSize=244;log(`Could not request CRP packet length; falling back to the V2 default of 244 bytes (${error.message}).`);}
  const start=new Uint8Array([0xfe,0xea,0x20,0x09,0x74,(length>>>24)&255,(length>>>16)&255,(length>>>8)&255,length&255]);
  const blockCount=Math.ceil(length/blockSize);
  conn.faceChunkSize=244;conn.faceTransfer={mode:"indexed",sent:0,total:length,pendingRequests:[],pendingKeys:new Set(),waiter:null,sendingIndex:null,receivedRequests:0,ignoredDuplicates:0,retries:new Map()};conn.faceAbortError=null;setBusy(true);el.disconnect.disabled=true;el.faceProgress.value=0;el.faceUploadStatus.className="muted";el.faceUploadStatus.textContent=`Starting indexed transfer… ${length.toLocaleString("en-GB")} bytes in ${blockCount.toLocaleString("en-GB")} blocks.`;setState(`Uploading watch face: 0% (${length.toLocaleString("en-GB")} bytes)…`);log(`CRP watch-face transfer to the download slot started: ${selectedFace.file.name}, block size ${blockSize}, FEE6 fragment ${conn.faceChunkSize}.`);
  try{
    await writeWithoutResponse(conn.out,start);await delay(500);
    while(true){
      const payload=await nextFaceTransferRequest();
      if(payload.length<2)throw new Error(`Invalid 0x74 block request: ${hex(payload)}.`);
      const index=(payload[0]<<8)|payload[1];
      if(index===0xffff){
        if(payload.length<4)throw new Error("The watch reported the end of the transfer without a file CRC.");
        const watchCrc=(payload[2]<<8)|payload[3],localCrc=crpFileCrc(bytes);
        log(`Da Fit file CRC (complete file): watch=0x${watchCrc.toString(16).padStart(4,"0")}, local=0x${localCrc.toString(16).padStart(4,"0")}.`);
        if(watchCrc!==localCrc){await writeWithoutResponse(conn.out,packet(0x74,[255,255,255,255]));throw new Error("CRC check failed; the watch did not receive exactly the same file.");}
        await writeWithoutResponse(conn.out,packet(0x74,[0,0,0,0]));el.faceProgress.value=100;el.faceUploadStatus.textContent="CRC confirmed; the watch is installing the watch face…";log("CRC check passed; installation confirmation sent to the watch.");break;
      }
      if(index>=blockCount)throw new Error(`The watch requested invalid block ${index}; this file has ${blockCount} blocks.`);
      const attempt=(conn.faceTransfer.retries.get(index)||0)+1;conn.faceTransfer.retries.set(index,attempt);
      if(attempt>30)throw new Error(`Block ${index} was still not accepted after 30 attempts; file-block size ${blockSize} and FEE6 fragment size ${conn.faceChunkSize}.`);
      const offset=index*blockSize,data=bytes.slice(offset,Math.min(offset+blockSize,length));
      conn.faceTransfer.sendingIndex=index;
      await sendFaceDataBlock(data);
      conn.faceTransfer.sendingIndex=null;
      conn.faceTransfer.sent=Math.max(conn.faceTransfer.sent,Math.min(offset+data.length,length));
      const percent=Math.min(99,Math.round(conn.faceTransfer.sent*100/length));el.faceProgress.value=percent;el.faceUploadStatus.textContent=`Block ${index+1} of ${blockCount} sent: ${percent}%${attempt>1?` (attempt ${attempt})`:""}.`;setState(`Uploading watch face: ${percent}%…`);
      if(index===0||index===blockCount-1||index%16===15||attempt>1)log(`Block ${index} sent${attempt>1?` (attempt ${attempt})`:""}; progress ${percent}%.`);
    }
    await delay(1400);
    const after=await queryFaceState("After upload"),target=deriveDisplayFace(before,after,selectedDisplayFace());
    if(target===6&&after.count===null)log("After upload: template 34 adds the custom watch face as visible index 6; that index will now be activated.");
    el.faceIndex.value=String(target);
    const verified=await setAndVerifyFace(target);
    if(verified!==null&&verified!==target)throw new Error(`Upload received, but activation failed: the watch reports index ${verified} instead of ${target}.`);
    el.faceProgress.value=100;el.faceUploadStatus.className="ok";el.faceUploadStatus.textContent=`File and CRC confirmed; visible index ${target} selected${verified===target?" and read back":""}. Check the watch.`;setState(`Watch face with valid CRC installed; index ${target} activated.`,"ok");log(`Watch face activated through display index ${target} after a valid CRC; read back=${verified??"unknown"}.`);
  }catch(error){
    if(conn.faceTransfer?.waiter){const waiter=conn.faceTransfer.waiter;conn.faceTransfer.waiter=null;clearTimeout(waiter.timer);waiter.reject(error);}
    if(conn.device?.gatt?.connected){try{await writeWithoutResponse(conn.out,packet(0x74,[255,255,255,255]));}catch{}}
    el.faceProgress.value=0;el.faceUploadStatus.className="bad";el.faceUploadStatus.textContent=`Upload stopped: ${error.message}`;throw error;
  }finally{if(conn.faceTransfer)log(`CRP requests received: ${conn.faceTransfer.receivedRequests}; duplicates ignored during transfer: ${conn.faceTransfer.ignoredDuplicates}.`);conn.faceTransfer=null;conn.faceAbortError=null;setBusy(false);}
}

function sleepSegments(stages) {
  return stages.map((stage,i)=>{ const start=new Date(stage.at), end=i+1<stages.length?new Date(stages[i+1].at):new Date(Math.min(Date.now(),start.getTime()+30*60000)); return {...stage,minutes:Math.max(0,Math.round((end-start)/60000))}; }).filter(s=>s.minutes>0 && s.minutes<12*60);
}
function render() {
  const vitalCards=[];
  const latestHr=dataset.vitals.heartRate.at(-1),latestBp=dataset.vitals.bloodPressure.at(-1);
  if(latestHr)vitalCards.push(`<article class="card"><div class="date">Heart rate · ${new Date(latestHr.at).toLocaleString("en-GB")}</div><div class="big">${latestHr.bpm} bpm</div><div class="muted">Current optical measurement</div></article>`);
  if(latestBp)vitalCards.push(`<article class="card"><div class="date">Blood pressure · ${new Date(latestBp.at).toLocaleString("en-GB")}</div><div class="big">${latestBp.systolic}/${latestBp.diastolic} mmHg</div><div class="bad">Experimental algorithmic estimate</div></article>`);
  el.vitals.innerHTML=vitalCards.length?vitalCards.join(""):'<div class="empty">No current measurement has been taken.</div>';
  el.activity.innerHTML=dataset.activity.length?dataset.activity.map(a=>`<article class="card"><div class="date">${formatDate(a.date)}</div><div class="big">${formatNumber(a.steps)} steps</div><div class="trio"><span>Distance<b>${(a.distanceMeters/1000).toLocaleString("en-GB",{maximumFractionDigits:2})} km</b></span><span>Calories<b>${formatNumber(a.calories)} kcal</b></span><span>Day<b>${a.date}</b></span></div></article>`).join(""):'<div class="empty">No activity data received.</div>';
  el.sleep.innerHTML=dataset.sleep.length?dataset.sleep.map(s=>{ const seg=sleepSegments(s.stages),total=seg.reduce((n,x)=>n+x.minutes,0),asleep=seg.filter(x=>x.type!==0).reduce((n,x)=>n+x.minutes,0); const bars=seg.map(x=>`<i class="stage-${x.type}" style="width:${total?100*x.minutes/total:0}%" title="${["Awake","Light","Deep","REM"][x.type]}: ${x.minutes} min"></i>`).join(""); return `<article class="card" style="margin-top:12px"><div class="date">${formatDate(s.date)}</div><div class="big">${Math.floor(asleep/60)} h ${asleep%60} min sleep</div><div class="sleepbar">${bars}</div><div class="muted">${s.stages.length} stage changes · recorded period ${Math.floor(total/60)} h ${total%60} min</div></article>`; }).join(""):'<div class="empty">No sleep data received.</div>';
  if(dataset.heartRate.length){ const values=dataset.heartRate.map(x=>x.bpm),avg=Math.round(values.reduce((a,b)=>a+b,0)/values.length),recent=[...dataset.heartRate].reverse().slice(0,12); el.heart.innerHTML=`<div class="grid"><div class="card"><div class="date">Average</div><div class="big">${avg} bpm</div></div><div class="card"><div class="date">Lowest</div><div class="big">${Math.min(...values)} bpm</div></div><div class="card"><div class="date">Highest</div><div class="big">${Math.max(...values)} bpm</div></div></div><table><thead><tr><th>Time</th><th>Heart rate</th></tr></thead><tbody>${recent.map(x=>`<tr><td>${new Date(x.at).toLocaleString("en-GB")}</td><td>${x.bpm} bpm</td></tr>`).join("")}</tbody></table>`; }
  else el.heart.innerHTML='<div class="empty">The watch returned no stored heart-rate measurements. Some Magic3 firmware does not retain them.</div>';
}
function csvEscape(value){ const s=String(value??""); return /[",\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s; }
function enableExports(){ el.exportCsv.disabled=false;el.exportJson.disabled=false; }
function exportCsv(){ const rows=[["category","date_time","steps","distance_metres","calories_kcal","sleep_stage","duration_minutes","heart_rate_bpm","systolic_mmhg","diastolic_mmhg"]]; dataset.activity.forEach(a=>rows.push(["activity",a.date,a.steps,a.distanceMeters,a.calories,"","","","",""])); dataset.sleep.forEach(s=>sleepSegments(s.stages).forEach(x=>rows.push(["sleep",x.at,"","","",["awake","light","deep","rem"][x.type],x.minutes,"","",""]))); dataset.heartRate.forEach(x=>rows.push(["heart_rate_history",x.at,"","","","","",x.bpm,"",""])); dataset.vitals.heartRate.forEach(x=>rows.push(["current_heart_rate",x.at,"","","","","",x.bpm,"",""])); dataset.vitals.bloodPressure.forEach(x=>rows.push(["blood_pressure",x.at,"","","","","","",x.systolic,x.diastolic])); download(`magic3-health-${localDate()}.csv`,"text/csv;charset=utf-8",'\ufeff'+rows.map(r=>r.map(csvEscape).join(";")).join("\r\n")); }
function exportJson(){ download(`magic3-health-${localDate()}.json`,"application/json",JSON.stringify(dataset,null,2)); }
function download(name,type,content){ const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement("a"); a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
function fail(error){ log(`ERROR: ${error.message||error}`,true); setState(error.message||String(error),"bad"); setBusy(false); }
function failFaceUpload(error){el.faceUploadStatus.className="bad";el.faceUploadStatus.textContent=`Upload not started: ${error.message||error}`;fail(error);}

el.connect.addEventListener("click",()=>connect().catch(fail));el.chooseDevice.addEventListener("click",()=>connect(true).catch(fail)); el.fetch.addEventListener("click",()=>fetchData().catch(fail)); el.syncTime.addEventListener("click",()=>syncTime().catch(fail)); el.measureHr.addEventListener("click",()=>measureHeartRate().catch(fail)); el.measureBp.addEventListener("click",()=>measureBloodPressure().catch(fail)); el.disconnect.addEventListener("click",()=>disconnect().catch(fail)); el.exportCsv.addEventListener("click",exportCsv); el.exportJson.addEventListener("click",exportJson); el.faceFile.addEventListener("change",()=>selectFaceFile().catch(fail)); el.loadTypeB.addEventListener("click",()=>loadTypeBSample().catch(fail)); el.uploadFace.addEventListener("click",()=>uploadWatchFace().catch(failFaceUpload));
el.activateCustomFace.addEventListener("click",()=>activateLatestFace().catch(failFaceUpload));
el.readSettings.addEventListener("click",()=>readWatchSettings().catch(fail));
el.findWatch.addEventListener("click",()=>findWatch().catch(fail));
el.saveBasics.addEventListener("click",()=>saveBasics().catch(fail));
el.saveQuickView.addEventListener("click",()=>saveQuickView().catch(fail));
el.saveDnd.addEventListener("click",()=>saveDnd().catch(fail));
el.saveMove.addEventListener("click",()=>saveMove().catch(fail));
el.saveAlarm.addEventListener("click",()=>saveAlarm().catch(fail));
el.buildFace.addEventListener("click",()=>{try{makeWatchFace();}catch(error){fail(error);}});
el.downloadBuiltFace.addEventListener("click",()=>{if(generatedFace)download(generatedFace.name,"application/octet-stream",generatedFace.bytes);});
el.faceBackgroundFile.addEventListener("change",()=>loadFaceBackground().catch(fail));
for(const input of [el.faceTitle,el.faceAccent,el.faceBackgroundColor,el.backgroundOpacity,el.showDate,el.showSteps,el.showDistance,el.showHeart,el.showBattery])input.addEventListener("input",editorChanged);
el.settingUnits.addEventListener("input",editorChanged);
el.clockStyle.addEventListener("input",scaleModeChanged);el.transparentParts.addEventListener("input",scaleModeChanged);
el.movePart.addEventListener("change",syncPositionControls);el.partX.addEventListener("input",()=>setPartPosition(Number(el.partX.value),Number(el.partY.value)));el.partY.addEventListener("input",()=>setPartPosition(Number(el.partX.value),Number(el.partY.value)));el.partScale.addEventListener("input",()=>setPartScale(Number(el.partScale.value)));
el.facePreview.addEventListener("pointerdown",startPartDrag);el.facePreview.addEventListener("pointermove",movePartDrag);el.facePreview.addEventListener("pointerup",endPartDrag);el.facePreview.addEventListener("pointercancel",endPartDrag);
navButtons.forEach(button=>button.addEventListener("click",()=>setActivePage(button.dataset.target)));
syncPositionControls();
setActivePage("overview",false);
log(navigator.bluetooth?`Magic3 dashboard ${APP_VERSION} ready. Choose your Magic3/C17 first.`:"Web Bluetooth is unavailable; open via localhost in Chrome or Edge.",!navigator.bluetooth);
prepareRememberedDevice();
