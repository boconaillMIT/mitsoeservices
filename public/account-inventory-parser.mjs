const header=v=>String(v??'').trim().toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ');
const names={account:['cost object','cost collector id','account','account number'],name:['cost object name','cost collector name','account name'],fundCenter:['fund center','fund center name'],profitCenter:['profit center','profit center name'],control:['control','admin flag'],closed:['closed','is closed cost collector']};
export function parseDelimited(text,delimiter){
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else if(!cell||quoted)quoted=!quoted;else throw Error('Invalid quoted CSV field.');}
  else if(!quoted&&c===delimiter){row.push(cell);cell='';}
  else if(!quoted&&(c==='\r'||c==='\n')){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';}
  else cell+=c;
  if(rows.length>100000)throw Error('Use an account-level export with fewer than 100,000 source lines.');
 }
 if(quoted)throw Error('A CSV quote was not closed.');if(cell||row.length){row.push(cell);rows.push(row);}return rows;
}
export function extractAccountRows(rows){
 let index=-1,columns;
 for(let i=0;i<Math.min(rows.length,30);i++){
  const h=rows[i].map(header),map=Object.fromEntries(Object.entries(names).map(([k,aliases])=>[k,h.findIndex(v=>aliases.includes(v))]));
  if(['account','name','fundCenter'].every(k=>map[k]>=0)){index=i;columns=map;break;}
 }
 if(index<0)throw Error('Required headers were not found: Cost Object, Cost Object Name, Fund Center. Use an account-level data export.');
 const unique=new Map();
 for(const row of rows.slice(index+1)){
  const raw=String(row[columns.account]??'').trim();if(!raw||/^total(?:\s|$)/i.test(raw))continue;
  if(!/^\d{7}$/.test(raw))throw Error('An account number is not seven digits. Export account-level data, without merged summary rows.');
  const account=Object.fromEntries(Object.entries(columns).map(([k,i])=>[k,i<0?'':String(row[i]??'').trim()]));
  if(!account.name)throw Error('Each account needs its name.');
  if(unique.has(raw)&&JSON.stringify(unique.get(raw))!==JSON.stringify(account))throw Error('An account has conflicting center or name details. Review the source export.');
  unique.set(raw,account);if(unique.size>10000)throw Error('Use at most 10,000 distinct accounts.');
 }
 if(!unique.size)throw Error('No accounts were found.');return [...unique.values()];
}
export async function readAccountFile(file,zipLibrary=globalThis.JSZip){
 if(!file||file.size<1||file.size>10*1024*1024)throw Error('Choose a nonempty CSV, TSV, or XLSX file up to 10 MB.');
 const bytes=await file.arrayBuffer(),sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
 if(/\.(csv|tsv)$/i.test(file.name)){
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,''),delimiter=/\.tsv$/i.test(file.name)?'\t':text.split(/\r?\n/,1)[0].includes('\t')?'\t':',';
  return {accounts:extractAccountRows(parseDelimited(text,delimiter)),sha256};
 }
 if(!/\.xlsx$/i.test(file.name)||!zipLibrary)throw Error('Use CSV, TSV, or Excel .xlsx.');
 const zip=await zipLibrary.loadAsync(bytes);let expanded=0;
 for(const item of Object.values(zip.files)){expanded+=item._data?.uncompressedSize||0;if(expanded>50*1024*1024)throw Error('Expanded Excel file is too large. Export account-level CSV instead.');}
 const parse=text=>{const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.querySelector('parsererror'))throw Error('Invalid Excel XML.');return doc;};
 const texts=el=>Array.from(el.getElementsByTagNameNS('*','t'),n=>n.textContent).join('');
 const shared=zip.file('xl/sharedStrings.xml')?Array.from(parse(await zip.file('xl/sharedStrings.xml').async('string')).getElementsByTagNameNS('*','si'),texts):[];
 const workbook=parse(await zip.file('xl/workbook.xml').async('string')),sheets=Array.from(workbook.getElementsByTagNameNS('*','sheet'));
 if(sheets.length>8)throw Error('Use a data export with at most eight worksheets.');
 const rels=parse(await zip.file('xl/_rels/workbook.xml.rels').async('string')),candidates=[];
 for(const sheet of sheets){
  const relation=Array.from(rels.getElementsByTagNameNS('*','Relationship')).find(r=>r.getAttribute('Id')===sheet.getAttribute('r:id'));if(!relation||relation.getAttribute('TargetMode')==='External')continue;
  const target=relation.getAttribute('Target'),name=target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,'');if(!zip.file(name))throw Error('Missing Excel worksheet.');
  const rows=[];
  for(const row of Array.from(parse(await zip.file(name).async('string')).getElementsByTagNameNS('*','row'))){
   const values=[];for(const cell of Array.from(row.getElementsByTagNameNS('*','c'))){let index=0;for(const c of (cell.getAttribute('r')||'').replace(/\d/g,''))index=index*26+c.charCodeAt(0)-64;if(index<1||index>250)throw Error('Unexpected Excel column.');const v=cell.getElementsByTagNameNS('*','v')[0]?.textContent||'';values[index-1]=cell.getAttribute('t')==='s'?shared[Number(v)]||'':cell.getAttribute('t')==='inlineStr'?texts(cell):v;}rows.push(values);if(rows.length>100000)throw Error('Use an account-level export.');
  }
  const hasHeaders=rows.slice(0,30).some(r=>Object.values(names).slice(0,3).every(aliases=>r.some(v=>aliases.includes(header(v)))));
  if(hasHeaders)candidates.push(extractAccountRows(rows));
 }
 if(candidates.length!==1)throw Error('Expected one account-data worksheet. Export that worksheet as CSV.');return {accounts:candidates[0],sha256};
}
