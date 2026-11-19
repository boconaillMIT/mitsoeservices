import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {FUNDING,fundingSummary,sortProposals,validateReview} from './rct-model.mjs';
const xml=v=>String(v).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const cols='ABCDEFGHIJKLMNOPQRSTUV'.split('');
// Retain the provided workbook's styles and table, replacing external links with
// source values and local, editable funding formulas. Unset amounts remain blank.
export function exportReviews(template,records){
 if(!records.length||records.length>200)throw Error('Invalid proposal count.');
 records=sortProposals(records).map(r=>({...r,review:validateReview(r.review)}));
 const zip=unzipSync(new Uint8Array(template)),sheetPath='xl/worksheets/sheet1.xml';
 let sheet=strFromU8(zip[sheetPath]);const originalRows=[...sheet.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g)],rowTemplate=originalRows.find(r=>r[1]==='8')?.[0],totals=originalRows.find(r=>r[1]==='18')?.[0];if(!rowTemplate||!totals)throw Error('Unexpected review template.');
 const styleOf=(row,col)=>new RegExp(`<c\\b[^>]*r="${col}\\d+"[^>]*\\bs="(\\d+)"`).exec(row)?.[1];
 const cell=(col,row,value,formula=null,base=rowTemplate)=>{const style=styleOf(base,col),attrs=`r="${col}${row}"${style?` s="${style}"`:''}`;
  if(formula!==null)return `<c ${attrs}${value===null?' t="str"':''}><f>${xml(formula)}</f><v>${value===null?'':Number(value)}</v></c>`;
  if(value===null||value===undefined||value==='')return `<c ${attrs}/>`;
  if(typeof value==='number'){if(!Number.isFinite(value))throw Error('Invalid workbook amount.');return `<c ${attrs}><v>${value}</v></c>`;}
  return `<c ${attrs} t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
 };
 const first=8,last=first+records.length-1,total=last+1;
 const sum=k=>Math.round(records.reduce((n,r)=>n+(r.review[k]??0),0)*100)/100;
 const requested=records.reduce((n,r)=>n+r.source.requested,0),awards=records.some(r=>r.review.award!==null)?sum('award'):null;
 let rows=originalRows.filter(r=>Number(r[1])<8).map(r=>{
  if(r[1]==='3')return `<row r="3">${cell('A',3,'Enter reviews in SoE HQ RCT review, or edit this standalone downloaded workbook.')}</row>`;
  if(r[1]==='4')return `<row r="4">${cell('A',4,'Download contains saved reviews. Offline Excel edits are not uploaded to the site.')}</row>`;
  if(r[1]==='5')return r[0].replace(/<c\b[^>]*r="B5"[\s\S]*?<\/c>/,cell('B',5,requested,`SUM(E${first}:E${last})`,r[0])).replace(/<c\b[^>]*r="E5"[\s\S]*?<\/c>/,cell('E',5,awards,`IF(COUNT(G${first}:G${last})=0,"",SUM(G${first}:G${last}))`,r[0])).replace(/<c\b[^>]*r="H5"[\s\S]*?<\/c>/,cell('H',5,records.length,`COUNTA(B${first}:B${last})`,r[0]));
  return r[0];
 }).join('');
 const allValues=[];
 for(const [i,record]of records.entries()){
  const r=first+i,s=record.source,v=record.review,f=fundingSummary(v);
  const values={A:s.area,B:s.pi,C:s.department,D:s.duration,E:s.requested,F:s.budgetTotal,G:v.award,...Object.fromEntries(FUNDING.map(([key,,col])=>[col,v[key]])),N:f.local,O:f.central,P:f.assigned,Q:f.unallocated,R:v.decision,S:v.notes,T:s.prior,U:s.budgetDifference,V:s.sourceNotes};allValues.push(values);
  const formulas={N:`IF(COUNT(J${r}:L${r})=0,"",SUM(J${r}:L${r}))`,O:`IF(G${r}="","",G${r}-SUM(J${r}:L${r}))`,P:`IF(COUNT(H${r}:M${r})=0,"",SUM(H${r}:M${r}))`,Q:`IF(G${r}="","",G${r}-SUM(H${r}:M${r}))`};
  rows+=`<row r="${r}" ht="100" customHeight="1">${cols.map(c=>cell(c,r,values[c],formulas[c]??null)).join('')}</row>`;
 }
 rows+=`<row r="${total}" ht="24" customHeight="1">${cols.map(c=>{if(c==='A')return cell(c,total,'TOTALS',null,totals);if('EFGHIJKLMNOPQU'.includes(c)){const nums=allValues.map(v=>v[c]).filter(v=>typeof v==='number'),n=nums.length?Math.round(nums.reduce((a,b)=>a+b,0)*100)/100:null;return cell(c,total,n,`IF(COUNT(${c}${first}:${c}${last})=0,"",SUM(${c}${first}:${c}${last}))`,totals);}return cell(c,total,null,null,totals);}).join('')}</row>`;
 sheet=sheet.replace(/<sheetData>[\s\S]*?<\/sheetData>/,`<sheetData>${rows}</sheetData>`).replace(/<dimension ref="[^"]*"\/>/,`<dimension ref="A2:V${total}"/>`).replace(/Q11:Q17/g,`Q11:Q${last}`).replace(/U11:U17/g,`U11:U${last}`);
 zip[sheetPath]=strToU8(sheet);
 let table=strFromU8(zip['xl/tables/table1.xml']).replace(/ref="A7:V17"/g,`ref="A7:V${last}"`).replace(/<calculatedColumnFormula>[\s\S]*?<\/calculatedColumnFormula>/g,'');zip['xl/tables/table1.xml']=strToU8(table);
 zip['xl/workbook.xml']=strToU8(strFromU8(zip['xl/workbook.xml']).replace(/<externalReferences>[\s\S]*?<\/externalReferences>/,'').replace(/<calcPr\b[^>]*\/>/,'<calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/>'));
 zip['xl/_rels/workbook.xml.rels']=strToU8(strFromU8(zip['xl/_rels/workbook.xml.rels']).replace(/<Relationship\b[^>]*Type="[^"]*\/(externalLink|calcChain)"[^>]*\/>/g,''));
 zip['[Content_Types].xml']=strToU8(strFromU8(zip['[Content_Types].xml']).replace(/<Override\b[^>]*PartName="\/xl\/(externalLinks\/[^"\s]+|calcChain.xml)"[^>]*\/>/g,''));
 for(const name of Object.keys(zip))if(name.startsWith('xl/externalLinks/')||name==='xl/calcChain.xml')delete zip[name];
 addReviewDetails(zip,records);
 return Buffer.from(zipSync(zip));
}

function addReviewDetails(zip,records){
 const workbook=strFromU8(zip['xl/workbook.xml']),rels=strFromU8(zip['xl/_rels/workbook.xml.rels']);
 const sheetId=Math.max(0,...[...workbook.matchAll(/sheetId="(\d+)"/g)].map(m=>Number(m[1])))+1;
 const relId='rId'+(Math.max(0,...[...rels.matchAll(/Id="rId(\d+)"/g)].map(m=>Number(m[1])))+1);
 const sheetPath='xl/worksheets/rct-review-details.xml';
 const styles=addDetailStyles(zip);
 const headers=['PI','Department','Overall priority (1 highest)','Graduate-student funding',...Array.from({length:6},(_,i)=>['Reviewer '+(i+1),'Grade (1–5)','Comments']).flat(),'Final proposal version','Earlier notes'];
 const column=i=>String.fromCharCode(65+i);
 const cell=(c,r,v)=>v===null||v===undefined?`<c r="${c}${r}" s="${r===1?styles.header:styles.body}"/>`:typeof v==='number'?`<c r="${c}${r}" s="${r===1?styles.header:styles.body}"><v>${v}</v></c>`:`<c r="${c}${r}" s="${r===1?styles.header:styles.body}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
 const rows=[headers,...records.map(({source:s,review:r,finalVersionLabel})=>[s.pi,s.department,r.priority,r.gradStudents===null?'Unknown':r.gradStudents?'Yes':'No',...r.reviewers.flatMap(v=>[v.name,v.grade?Number(v.grade):null,v.comments]),finalVersionLabel||r.finalVersion||'Not selected',r.notesHistory.map(n=>n.by+' · '+n.at+'\n'+n.text).join('\n\n')])];
 const contents=rows.map((values,i)=>`<row r="${i+1}" ht="${i?100:40}" customHeight="1">${values.map((v,j)=>cell(column(j),i+1,v)).join('')}</row>`).join('');
 zip[sheetPath]=strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:X${rows.length}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="2" width="32" customWidth="1"/><col min="3" max="4" width="22" customWidth="1"/>${Array.from({length:6},(_,i)=>`<col min="${5+3*i}" max="${5+3*i}" width="22" customWidth="1"/><col min="${6+3*i}" max="${6+3*i}" width="12" customWidth="1"/><col min="${7+3*i}" max="${7+3*i}" width="45" customWidth="1"/>`).join('')}<col min="23" max="24" width="45" customWidth="1"/></cols><sheetData>${contents}</sheetData><autoFilter ref="A1:X${rows.length}"/></worksheet>`);
 zip['xl/workbook.xml']=strToU8(workbook.replace('</sheets>',`<sheet name="Review details" sheetId="${sheetId}" r:id="${relId}"/></sheets>`));
 zip['xl/_rels/workbook.xml.rels']=strToU8(rels.replace('</Relationships>',`<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/rct-review-details.xml"/></Relationships>`));
 zip['[Content_Types].xml']=strToU8(strFromU8(zip['[Content_Types].xml']).replace('</Types>','<Override PartName="/xl/worksheets/rct-review-details.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'));
}

function addDetailStyles(zip){
 let styles=strFromU8(zip['xl/styles.xml']);
 const count=tag=>Number(new RegExp('<'+tag+'\\b[^>]*count="(\\d+)"').exec(styles)?.[1]);
 const font=count('fonts'),fill=count('fills'),body=count('cellXfs');
 // Minimal test templates need not provide a stylesheet; real source templates do.
 if(![font,fill,body].every(Number.isInteger))return {header:0,body:0};
 const append=(tag,content)=>{styles=styles.replace(new RegExp('(<'+tag+'\\b[^>]*count=")(\\d+)("[^>]*>)([\\s\\S]*?)(</'+tag+'>)'),(_,a,n,b,c,d)=>a+(Number(n)+1)+b+c+content+d);};
 append('fonts','<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>');
 append('fills','<fill><patternFill patternType="solid"><fgColor rgb="FF750014"/><bgColor indexed="64"/></patternFill></fill>');
 append('cellXfs','<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>');
 append('cellXfs',`<xf numFmtId="0" fontId="${font}" fillId="${fill}" borderId="0" xfId="0" applyAlignment="1" applyFont="1" applyFill="1"><alignment vertical="top" wrapText="1"/></xf>`);
 zip['xl/styles.xml']=strToU8(styles);return {body,header:body+1};
}
