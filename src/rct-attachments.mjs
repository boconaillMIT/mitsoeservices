import {createRctVersions,MAX_PDF_BYTES} from './rct-versions.mjs';
export const ATTACHMENT_TYPES={pdf:'application/pdf',eml:'message/rfc822',msg:'application/vnd.ms-outlook',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',txt:'text/plain',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg'};
const extension=name=>name.split('.').pop().toLowerCase();
export function validateAttachment(body){
 const error=()=>Error('Choose a PDF, email, Word, Excel, text or image file of 3 MB or smaller.');
 if(!body||Object.keys(body).some(k=>!['id','filename','content'].includes(k))||!/^FY27-RCT2\|[a-z-]{1,40}$/.test(body.id||'')||typeof body.filename!=='string'||body.filename.length>180||!Object.hasOwn(ATTACHMENT_TYPES,extension(body.filename))||/[\\/\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(body.filename)||body.filename!==body.filename.trim()||body.filename.startsWith('.')||typeof body.content!=='string'||!body.content.length||body.content.length>Math.ceil(MAX_PDF_BYTES/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(body.content))throw error();
 const bytes=Buffer.from(body.content,'base64'),ext=extension(body.filename);
 if(!bytes.length||bytes.length>MAX_PDF_BYTES||bytes.toString('base64')!==body.content)throw error();
 const head=bytes.subarray(0,8).toString('hex');
 if(ext==='pdf'&&bytes.subarray(0,5).toString()!=='%PDF-'||ext==='msg'&&head!=='d0cf11e0a1b11ae1'||['docx','xlsx'].includes(ext)&&!head.startsWith('504b0304')||ext==='png'&&head!=='89504e470d0a1a0a'||['jpg','jpeg'].includes(ext)&&!head.startsWith('ffd8ff'))throw error();
 if(['eml','txt'].includes(ext)&&bytes.includes(0))throw error();
 if(ext==='eml'&&!/^(?:from|to|subject|date|mime-version|received|return-path|message-id|content-type):/im.test(bytes.subarray(0,65536).toString('utf8')))throw error();
 return bytes;
}
// A distinct namespace in the existing file table keeps support files out of
// proposal versions and prevents them from being selected as the final proposal.
export function createRctAttachments(options={}){
 const store=createRctVersions({...options,namespace:'support|',validator:validateAttachment});
 return {...store,async download(proposal,id){const file=await store.download(proposal,id);return file?{...file,contentType:ATTACHMENT_TYPES[extension(file.filename)]}:null;}};
}
