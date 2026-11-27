export const MAX_REPORT_BYTES=2*1024*1024;
const clean=s=>String(s??'').replace(/^\uFEFF/,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function decodeReportBytes(input){const bytes=new Uint8Array(input);if(bytes.length>MAX_REPORT_BYTES)throw Error('Choose a CSV report smaller than 2 MB.');const encoding=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';try{return new TextDecoder(encoding,{fatal:true}).decode(bytes);}catch{throw Error('The report encoding could not be read. Export it again from MIT Reports.');}}
export function readReportCsv(text){
 if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_REPORT_BYTES)throw Error('Choose a CSV report smaller than 2 MB.');
 if(text.includes('\0'))throw Error('The report encoding could not be read. Export it again from MIT Reports.');
 const heading=text.split(/\r?\n/).find(line=>clean(line).includes('costcollectorid')&&clean(line).includes('unexpendedbalance'))||'';
 // Cognos CSV defaults to UTF-16LE with tabs and unquoted text. Also accept ordinary CSV exports.
 if(heading.includes('\t')){const rows=text.split(/\r\n|\r|\n/).filter(line=>line.trim()).map(line=>line.split('\t').map(s=>s.trim()));if(rows.length>6000||rows.some(row=>row.length>50||row.some(s=>s.length>20000)))throw Error('The report is larger than expected.');return rows;}
 const delimiter=heading.includes(';')&&!heading.includes(',')?';':',';
 const rows=[];let row=[],field='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;}
  else if(c==='"'){if(field.trim())throw Error('The CSV contains an invalid quote.');field='';quoted=true;}
  else if(c===delimiter||c==='\n'||c==='\r'){row.push(field.trim());field='';closed=false;if(c!==delimiter){if(row.some(Boolean))rows.push(row);row=[];if(c==='\r'&&text[i+1]==='\n')i++;}}
  else{if(closed&&!/\s/.test(c))throw Error('The CSV contains text after a closing quote.');field+=c;}
  if(rows.length>6000||row.length>50||field.length>20000)throw Error('The report is larger than expected.');
 }
 if(quoted)throw Error('The CSV has an unfinished quoted field.');row.push(field.trim());if(row.some(Boolean))rows.push(row);return rows;
}
const aliases={account:['costcollectorid'],currentBalance:['unexpendedbalance'],ytdExpenses:['fytdexpenses'],commitments:['totalsapfinancialcommitments','totalcommitments'],uncommitted:['uncommittedbalance']};
const amount=s=>{if(!s?.trim())throw Error('The report contains a blank required financial amount.');let t=s.replace(/[$,\s]/g,'');if(/^\(\d+(?:\.\d{1,2})?\)$/.test(t))t='-'+t.slice(1,-1);if(!/^-?\d+(?:\.\d{1,2})?$/.test(t)||!Number.isFinite(Number(t))||Math.abs(Number(t))>1e13)throw Error('The report contains an invalid financial amount.');return Number(t);};
export function prepareAccountRefresh(csv,current,asOf){
 if(!current?.rows?.length||current.unit!=='aeroastro'||!/^\d{4}-\d{2}-\d{2}$/.test(asOf||'')||!Number.isFinite(Date.parse(asOf))||new Date(asOf+'T00:00:00Z').toISOString().slice(0,10)!==asOf)throw Error('A verified current inventory and valid report date are required.');
 if(asOf<current.asOf)throw Error('Choose a report at least as recent as the saved figures.');
 const table=readReportCsv(csv),header=table.findIndex(r=>r.some(c=>clean(c)==='costcollectorid')&&r.some(c=>clean(c)==='unexpendedbalance'));
 if(header<0)throw Error('Use the CSV export of “Balances for Current Month No Prompt”.');
 const names=table[header].map(clean),index={};for(const [field,labels]of Object.entries(aliases)){const hits=names.flatMap((s,i)=>labels.includes(s)?[i]:[]);if(hits.length!==1)throw Error('The report needs one '+labels[0]+' column.');index[field]=hits[0];}
 const trusted=new Map(current.rows.map(r=>[r.account,r])),parsed=new Map(),totals=[];
 for(const cells of table.slice(header+1)){
  if(cells.length!==names.length)throw Error('The CSV row widths do not match its headings. Export the report again as CSV.');
  const id=cells[index.account];if(!/^\d{7}$/.test(id||'')){if(cells.some(c=>/^overall\s*[-–]?\s*total$/i.test(c)))totals.push(cells);else if(cells.every((c,i)=>!c||clean(c)===names[i]))continue;else throw Error('The CSV contains a subtotal or unrecognized row. Export the complete account list as CSV.');continue;}
  if(!trusted.has(id))throw Error('This report includes an account outside the verified AeroAstro inventory. Select only AeroAstro profit centers. New accounts need an inventory update by the site administrator.');
  if(parsed.has(id))throw Error('The report repeats an account. Export one row per account.');
  const values=Object.fromEntries(Object.keys(aliases).filter(k=>k!=='account').map(k=>[k,amount(cells[index[k]])]));
  if(Math.abs(values.currentBalance-values.commitments-values.uncommitted)>.02)throw Error('Unexpended balance, commitments and uncommitted balance do not reconcile.');parsed.set(id,values);
 }
 if(!parsed.size)throw Error('The report has no account balances.');
 if(current.rows.some(r=>r.currentBalance!==null&&r.currentBalance!==undefined&&!parsed.has(r.account)))throw Error('Some previously reported accounts are missing. Export all AeroAstro accounts, controls and account types. If an account has closed, ask the site administrator to update the inventory first.');
 const rows=current.rows.map(r=>{const v=parsed.get(r.account);return {...r,currentBalance:v?.currentBalance??null,ytdExpenses:v?.ytdExpenses??null,commitments:v?.commitments??null};});
 const sum=key=>Math.round(rows.reduce((n,r)=>n+(r[key]??0),0)*100)/100;
 const summary={accounts:rows.length,reported:parsed.size,changed:rows.filter((r,i)=>['currentBalance','ytdExpenses','commitments'].some(k=>r[k]!==current.rows[i][k])).length,currentBalance:sum('currentBalance'),ytdExpenses:sum('ytdExpenses'),commitments:sum('commitments')};
 if(totals.length>1)throw Error('The report contains more than one overall total.');
 if(totals.length)for(const k of ['currentBalance','ytdExpenses','commitments'])if(Math.abs(amount(totals[0][index[k]])-summary[k])>.02)throw Error('The account rows do not reconcile to the report total.');
 return {rows,summary};
}
