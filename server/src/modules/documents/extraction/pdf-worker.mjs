// Trusted fixed worker entry point. PDF bytes never become a URL, module, path, script or command.
import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';

// No remote CMaps/fonts/WASM or document-specified resource fetches in this text-only worker.
globalThis.fetch=async()=>{throw new Error('Network disabled in PDF extraction');};
const {getDocument,Util}=await import('pdfjs-dist/legacy/build/pdf.mjs');
let resourceRequested=false;
class NoExternalResources {
  async fetch({kind,filename}) {
    // Only named standard fonts inside the installed dependency; never PDF-supplied paths or URLs.
    if(kind==='standardFontDataUrl'&&/^[A-Za-z0-9_-]+\.(?:pfb|ttf)$/.test(filename))
      return new Uint8Array(await readFile(new URL('./standard_fonts/'+filename,import.meta.resolve('pdfjs-dist/package.json'))));
    resourceRequested=true;throw new Error('External PDF resources are unsupported');
  }
}
const {bytes,limits}=workerData;
let task;
function fail(code){throw Object.assign(new Error(code),{extractionCode:code});}
function geometry(item,style,viewport) {
  const t=Util.transform(viewport.transform,item.transform),h=Math.hypot(t[2],t[3]);
  const xLength=Math.hypot(t[0],t[1]);
  if(!Number.isFinite(h)||!h||!xLength)return null;
  const x=[t[0]/xLength,t[1]/xLength],up=[t[2]/h,t[3]/h];
  const width=item.width*Math.hypot(viewport.transform[0],viewport.transform[1]);
  const ascent=Number.isFinite(style.ascent)?style.ascent:.8,descent=Number.isFinite(style.descent)?style.descent:-.2;
  const points=[];
  for(const dx of [0,width])for(const dy of [descent*h,ascent*h])points.push([t[4]+dx*x[0]+dy*up[0],t[5]+dx*x[1]+dy*up[1]]);
  const box=[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
  if(!box.every(Number.isFinite)||box[2]<=box[0]||box[3]<=box[1])return null;
  // Text outside the crop area is not trustworthy evidence for a displayed highlight.
  if(box[0]<-.5||box[1]<-.5||box[2]>viewport.width+.5||box[3]>viewport.height+.5)return null;
  return {box:[Math.max(0,box[0]),Math.max(0,box[1]),Math.min(viewport.width,box[2]),Math.min(viewport.height,box[3])],
    baseline:t[5],height:h,angle:Math.atan2(t[1],t[0])};
}

async function extract() {
  let response;
  try {
    task=getDocument({data:bytes,verbosity:0,stopAtErrors:true,enableXfa:false,disableFontFace:true,useSystemFonts:false,
      useWorkerFetch:false,useWasm:false,maxImageSize:0,BinaryDataFactory:NoExternalResources,
      disableAutoFetch:true,disableStream:true,disableRange:true});
    const doc=await task.promise;
    if(doc.numPages>limits.maxPages)fail('PAGE_LIMIT');
    const pages=[];let chars=0,items=0;
    for(let number=1;number<=doc.numPages;number++) {
      const page=await doc.getPage(number);
      try {
        const viewport=page.getViewport({scale:1}),layout=page.getViewport({scale:1,rotation:0});
        const spans=[];let pageChars=0,pageItems=0,unsupported=false;
        // Streaming avoids building an unbounded page text array before checking counters.
        const reader=page.streamTextContent({disableNormalization:true}).getReader();
        try {
          while(true) {
            const chunk=await reader.read();if(chunk.done)break;
            for(const item of chunk.value.items) {
              if(!('str' in item))continue;
              items++;pageItems++;chars+=item.str.length;pageChars+=item.str.length;
              if(items>limits.maxItems||pageItems>limits.maxItemsPerPage)fail('ITEM_LIMIT');
              if(chars>limits.maxChars||pageChars>limits.maxCharsPerPage)fail('TEXT_LIMIT');
              if(!item.str.trim())continue;
              const style=chunk.value.styles[item.fontName]??{},g=geometry(item,style,viewport),l=geometry(item,style,layout);
              if(item.dir!=='ltr'||style.vertical||!g||!l||Math.abs(l.angle)>.05){unsupported=true;continue;}
              spans.push({text:item.str,bbox:g.box,layoutBox:l.box,baseline:l.baseline,height:l.height});
            }
          }
        } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
        pages.push({page:number,width:viewport.width,height:viewport.height,rotation:viewport.rotation,unsupported,spans});
      } finally {page.cleanup();}
    }
    if(resourceRequested)fail('UNSUPPORTED_RESOURCES');
    response={ok:true,pages};
  } catch(error) {
    response={ok:false,code:error.extractionCode??(error.name==='PasswordException'?'PDF_ENCRYPTED':'PDF_MALFORMED')};
  } finally {
    try {await task?.destroy();}catch{response={ok:false,code:'PDF_MALFORMED'};}
  }
  parentPort.postMessage(response);
}
await extract();
