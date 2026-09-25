export const MAGIC3_WIDTH = 240;
export const MAGIC3_HEIGHT = 280;

const HEADER_SIZE = 1900;
const MAX_ENTRIES = 39;
const MAX_BLOBS = 250;
const TYPE_B_BLOCK_SIZE = 1024;
const TYPE_B_PAYLOAD_SIZE = 300 * 1024;

function deduplicateBlobs(blobs) {
  const offsets=new Uint32Array(blobs.length),unique=[],seen=new Map();let payloadLength=0;
  for(let index=0;index<blobs.length;index++){
    const blob=blobs[index],match=seen.get(blob);
    if(match!==undefined)offsets[index]=match;
    else{offsets[index]=payloadLength;unique.push({blob,offset:payloadLength});seen.set(blob,payloadLength);payloadLength+=blob.length;}
  }
  return {offsets,unique,payloadLength};
}

// Clean-room LZO1X-1 compressor, adapted from lzo1x 1.0.1 (MIT).
// Type-B faces use the same raw LZO stream as Da Fit's MiniLzoHelper.
const LZO_HASH_BITS=13,LZO_HASH_SIZE=1<<LZO_HASH_BITS,LZO_HASH_MASK=LZO_HASH_SIZE-1;
function lzoHash3(bytes,offset){const value=bytes[offset]|(bytes[offset+1]<<8)|(bytes[offset+2]<<16);return (Math.imul(value,506832829)>>>(32-LZO_HASH_BITS))&LZO_HASH_MASK;}
function lzo1xCompress(input){
  const inputLength=input.length,output=new Uint8Array(inputLength+((inputLength+15)>>>4)+83),table=new Int32Array(LZO_HASH_SIZE).fill(-1);
  let outputOffset=0,literalStart=0,inputOffset=0,firstFrame=true;const scanEnd=inputLength-20;
  const emitLiterals=(length,first)=>{
    if(first&&length!==0&&length<=238)output[outputOffset++]=17+length;
    else if(length<=3)output[outputOffset-2]=(output[outputOffset-2]|length)&255;
    else if(length<=18)output[outputOffset++]=length-3;
    else{output[outputOffset++]=0;let remaining=length-18;while(remaining>255){output[outputOffset++]=0;remaining-=255;}output[outputOffset++]=remaining;}
    output.set(input.subarray(literalStart,literalStart+length),outputOffset);outputOffset+=length;
  };
  const emitMatch=(length,distance,literalLength)=>{
    if(length===2){const value=distance-1;output[outputOffset++]=((value&3)<<2)&255;output[outputOffset++]=(value>>>2)&255;}
    else if(length<=8&&distance<=2048){const value=distance-1;output[outputOffset++]=(((length-1)<<5)|((value&7)<<2))&255;output[outputOffset++]=(value>>>3)&255;}
    else if(length===3&&distance<=3072&&literalLength>=4){const value=distance-1-2048;output[outputOffset++]=((value&3)<<2)&255;output[outputOffset++]=(value>>>2)&255;}
    else if(distance<=16384){const value=distance-1;if(length<=33)output[outputOffset++]=(32|length-2)&255;else{output[outputOffset++]=32;let remaining=length-33;while(remaining>255){output[outputOffset++]=0;remaining-=255;}output[outputOffset++]=remaining;}output[outputOffset++]=(value<<2)&255;output[outputOffset++]=(value>>>6)&255;}
    else{const value=distance-16384;if(length<=9)output[outputOffset++]=(16|((value&16384)>>>11)|length-2)&255;else{output[outputOffset++]=(16|((value&16384)>>>11))&255;let remaining=length-9;while(remaining>255){output[outputOffset++]=0;remaining-=255;}output[outputOffset++]=remaining;}output[outputOffset++]=(value<<2)&255;output[outputOffset++]=(value>>>6)&255;}
  };
  while(inputOffset<scanEnd){
    const hash=lzoHash3(input,inputOffset),reference=table[hash];table[hash]=inputOffset;let matchLength=0,matchDistance=0;
    if(reference>=0&&inputOffset-reference<=49151&&inputOffset>reference&&input[reference]===input[inputOffset]&&input[reference+1]===input[inputOffset+1]&&input[reference+2]===input[inputOffset+2]){let length=3,maxLength=Math.min(scanEnd-inputOffset,inputLength-reference);while(length<maxLength&&input[reference+length]===input[inputOffset+length])length++;matchLength=length;matchDistance=inputOffset-reference;}
    if(matchLength){const literalLength=inputOffset-literalStart,valid=(matchLength===2&&matchDistance<=1024&&literalLength>=4&&!firstFrame)||(matchLength>=3&&matchLength<=8&&matchDistance<=2048)||(matchLength===3&&matchDistance>2048&&matchDistance<=3072&&literalLength>=4)||(matchLength>=3&&matchDistance<=49151);if(!valid)matchLength=0;}
    if(!matchLength){inputOffset++;continue;}
    const literalLength=inputOffset-literalStart;emitLiterals(literalLength,firstFrame&&outputOffset===0);firstFrame=false;emitMatch(matchLength,matchDistance,literalLength);inputOffset+=matchLength;literalStart=inputOffset;
  }
  emitLiterals(inputLength-literalStart,firstFrame&&outputOffset===0);output[outputOffset++]=17;output[outputOffset++]=0;output[outputOffset++]=0;return output.slice(0,outputOffset);
}

export function rgbaToRgb565(imageData) {
  const source=imageData.data??imageData;
  if(source.length%4!==0)throw new Error("Invalid RGBA image.");
  const result=new Uint8Array(source.length/2);
  for(let sourceOffset=0,targetOffset=0;sourceOffset<source.length;sourceOffset+=4,targetOffset+=2){
    const red=source[sourceOffset],green=source[sourceOffset+1],blue=source[sourceOffset+2];
    const pixel=((red&0xf8)<<8)|((green&0xfc)<<3)|(blue>>3);
    result[targetOffset]=pixel>>8; result[targetOffset+1]=pixel&0xff;
  }
  return result;
}

export function compressRleLine(raw,width,height) {
  if(!(raw instanceof Uint8Array)||raw.length!==width*height*2)throw new Error("Invalid RGB565 image for RLE compression.");
  const headerSize=2+height*2,output=[];for(let i=0;i<headerSize;i++)output.push(0);output[0]=0x08;output[1]=0x21;
  for(let y=0;y<height;y++){
    let rowOffset=y*width*2,runHigh=raw[rowOffset],runLow=raw[rowOffset+1],runLength=1;
    for(let x=1;x<width;x++){
      const offset=rowOffset+x*2,high=raw[offset],low=raw[offset+1];
      if(high===runHigh&&low===runLow&&runLength<255)runLength++;
      else {output.push(runHigh,runLow,runLength);runHigh=high;runLow=low;runLength=1;}
    }
    output.push(runHigh,runLow,runLength);
    if(output.length>65535||output.length>=raw.length)return raw;
    output[2+y*2]=output.length&0xff;output[3+y*2]=output.length>>8;
  }
  return output.length<raw.length?Uint8Array.from(output):raw;
}

export function buildTypeCFace({entries,blobs,faceNumber=51001,fileId=0x81}) {
  if(!Array.isArray(entries)||entries.length<1||entries.length>MAX_ENTRIES)throw new Error(`A Type-C watch face must have 1-${MAX_ENTRIES} fields.`);
  if(!Array.isArray(blobs)||blobs.length<1||blobs.length>MAX_BLOBS)throw new Error(`A Type-C watch face must have 1-${MAX_BLOBS} images.`);
  if(![0x81,0x84].includes(fileId))throw new Error("Only MoYoung Type-C file ID 0x81 or 0x84 is supported.");
  const normalized=blobs.map(blob=>blob instanceof Uint8Array?blob:new Uint8Array(blob));
  const payloadSize=normalized.reduce((total,blob)=>total+blob.length,0);
  const result=new Uint8Array(HEADER_SIZE+payloadSize),view=new DataView(result.buffer);
  result[0]=fileId; result[1]=entries.length; result[2]=normalized.length;
  view.setUint16(3,faceNumber,true);
  entries.forEach((entry,index)=>{
    const offset=5+index*10;
    result[offset]=entry.type; result[offset+1]=entry.imageIndex;
    view.setUint16(offset+2,entry.x,true); view.setUint16(offset+4,entry.y,true);
    view.setUint16(offset+6,entry.width,true); view.setUint16(offset+8,entry.height,true);
  });
  let relativeOffset=0,outputOffset=HEADER_SIZE;
  normalized.forEach((blob,index)=>{
    view.setUint32(400+index*4,relativeOffset,true);
    result.set(blob,outputOffset); relativeOffset+=blob.length; outputOffset+=blob.length;
  });
  return result;
}

export function buildTypeBFace({entries,blobs,faceNumber=51001,fileId=0x81}) {
  if(!Array.isArray(entries)||entries.length<1||entries.length>MAX_ENTRIES)throw new Error(`A Type-B watch face must have 1-${MAX_ENTRIES} fields.`);
  if(!Array.isArray(blobs)||blobs.length<1||blobs.length>MAX_BLOBS)throw new Error(`A Type-B watch face must have 1-${MAX_BLOBS} images.`);
  if(![0x81,0x84].includes(fileId))throw new Error("Only MoYoung Type-B file ID 0x81 or 0x84 is supported.");
  const normalized=blobs.map(blob=>blob instanceof Uint8Array?blob:new Uint8Array(blob));
  const {offsets,unique,payloadLength}=deduplicateBlobs(normalized);
  if(payloadLength>TYPE_B_PAYLOAD_SIZE)throw new Error(`The unpacked Type-B images use ${(payloadLength/1024).toFixed(1)} KiB; template 34 provides at most 300 KiB.`);
  const header=new Uint8Array(HEADER_SIZE),headerView=new DataView(header.buffer);
  header[0]=fileId;header[1]=entries.length;header[2]=normalized.length;headerView.setUint16(3,faceNumber,true);
  entries.forEach((entry,index)=>{const offset=5+index*10;header[offset]=entry.type;header[offset+1]=entry.imageIndex;headerView.setUint16(offset+2,entry.x,true);headerView.setUint16(offset+4,entry.y,true);headerView.setUint16(offset+6,entry.width,true);headerView.setUint16(offset+8,entry.height,true);});
  const rawPayload=new Uint8Array(TYPE_B_PAYLOAD_SIZE);
  normalized.forEach((blob,index)=>{headerView.setUint32(400+index*4,offsets[index],true);headerView.setUint16(1400+index*2,blob.length&0xffff,true);});
  unique.forEach(({blob,offset})=>rawPayload.set(blob,offset));
  const frames=[];let compressedLength=0;
  for(let offset=0;offset<rawPayload.length;offset+=TYPE_B_BLOCK_SIZE){
    const raw=rawPayload.subarray(offset,offset+TYPE_B_BLOCK_SIZE),compressed=lzo1xCompress(raw);
    if(compressed.length>=TYPE_B_BLOCK_SIZE){const frame=new Uint8Array(TYPE_B_BLOCK_SIZE+4);frame[0]=4;frame[1]=0;frame.set(raw,2);frame[frame.length-2]=4;frames.push(frame);compressedLength+=frame.length;}
    else{const storedLength=((compressed.length+5)&~3)-2,frame=new Uint8Array(2+storedLength);frame[0]=(compressed.length>>>8)&255;frame[1]=compressed.length&255;frame.set(compressed,2);frames.push(frame);compressedLength+=frame.length;}
  }
  const result=new Uint8Array(HEADER_SIZE+compressedLength);result.set(header);let outputOffset=HEADER_SIZE;for(const frame of frames){result.set(frame,outputOffset);outputOffset+=frame.length;}return result;
}
