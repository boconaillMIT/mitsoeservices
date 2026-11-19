import {createHash} from 'node:crypto';
export function dropboxLink(value,extension){
 const u=new URL(value);if(u.protocol!=='https:'||u.hostname!=='www.dropbox.com'||u.username||u.password||u.port||!/^\/scl\/(fo|fi)\//.test(u.pathname)||!u.pathname.toLowerCase().endsWith(extension))throw Error('Invalid Dropbox source link.');return u;
}
// Download the original template only while generating an authorized Excel export.
// No PDFs or workbooks are persisted in Netlify storage.
export async function loadDropboxTemplate(source,{fetcher=fetch,maxBytes=2*1024*1024}={}){
 let url=dropboxLink(source.workbookUrl,'.xlsx');url.searchParams.set('dl','1');
 if(!/^[a-f0-9]{64}$/.test(source.templateSha||''))throw Error('Workbook fingerprint is missing.');
 for(let i=0;i<6;i++){
  const r=await fetcher(url.toString(),{redirect:'manual',signal:AbortSignal.timeout(20000)});
  if([301,302,303,307,308].includes(r.status)){
   const location=r.headers.get('location');if(!location)throw Error('Dropbox download redirect is missing.');const next=new URL(location,url);
   if(next.protocol!=='https:'||next.username||next.password||next.port||!['www.dropbox.com','dropbox.com'].includes(next.hostname)&&!next.hostname.endsWith('.dropboxusercontent.com'))throw Error('Unexpected Dropbox download redirect.');
   await r.body?.cancel();url=next;continue;
  }
  if(!r.ok||Number(r.headers.get('content-length'))>maxBytes)throw Error('Source workbook is unavailable or too large.');
  const reader=r.body?.getReader();if(!reader)throw Error('Source workbook is empty.');const chunks=[];let size=0;
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw Error('Source workbook is too large.');}chunks.push(value);}
  const bytes=Buffer.concat(chunks);if(bytes.length<4||bytes[0]!==0x50||bytes[1]!==0x4b||createHash('sha256').update(bytes).digest('hex')!==source.templateSha)throw Error('The Dropbox workbook changed. Its source must be re-imported before exporting reviews.');return bytes;
 }
 throw Error('Too many Dropbox download redirects.');
}
