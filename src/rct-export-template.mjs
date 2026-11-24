import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {createRctVersions} from './rct-versions.mjs';
import {loadDropboxTemplate} from './rct-dropbox.mjs';
export const EXPORT_TEMPLATE_ID='FY27-RCT2|workbook';
export const exportTemplateNamespace=sha=>{if(!/^[a-f0-9]{64}$/.test(sha||''))throw Error('Invalid source workbook fingerprint.');return 'export-template:'+sha+':';};
export function validateExportLayout(body){
 const match=/^RCT-export-layout-([a-f0-9]{64})\.xlsx$/.exec(body?.filename||'');
 if(body?.id!==EXPORT_TEMPLATE_ID||!match||typeof body.content!=='string'||body.content.length>2800000||!/^[A-Za-z0-9+/]+={0,2}$/.test(body.content))throw Error('Invalid export layout file.');
 const bytes=Buffer.from(body.content,'base64');if(bytes.length<4||bytes.length>2*1024*1024||bytes.toString('base64')!==body.content||createHash('sha256').update(bytes).digest('hex')!==match[1])throw Error('Export layout fingerprint does not match.');
 let expanded=0;const zip=unzipSync(bytes,{filter:file=>{expanded+=file.originalSize;if(expanded>20*1024*1024)throw Error('Export layout is too large.');return true;}});
 if(!zip['xl/workbook.xml']||!zip['xl/worksheets/sheet1.xml']||!zip['xl/styles.xml']||Object.keys(zip).some(k=>/vbaProject/i.test(k)))throw Error('Invalid export workbook structure.');
 const sheet=new TextDecoder().decode(zip['xl/worksheets/sheet1.xml']);if(!/<row\b[^>]*\br="8"/.test(sheet)||!/<row\b[^>]*\br="18"/.test(sheet))throw Error('Unexpected export layout.');return bytes;
}
export function createExportTemplateLoader({versionsFactory=createRctVersions,remote=loadDropboxTemplate}={}){
 return async source=>{const files=versionsFactory({namespace:exportTemplateNamespace(source.templateSha),validator:validateExportLayout}),layouts=await files.list(EXPORT_TEMPLATE_ID);if(layouts.length>1)throw Object.assign(Error('More than one verified export layout is registered.'),{code:'RCT_TEMPLATE_AMBIGUOUS'});if(layouts.length===1){const file=await files.download(EXPORT_TEMPLATE_ID,layouts[0].id);if(!file)throw Object.assign(Error('Verified export layout is unavailable.'),{code:'RCT_TEMPLATE_UNAVAILABLE'});return file.bytes;}return remote(source);};
}
export const loadExportTemplate=createExportTemplateLoader();
