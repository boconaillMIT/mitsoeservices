import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {FUNDING,fundingSummary} from './rct-model.mjs';
const xml=v=>String(v).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const cols='ABCDEFGHIJKLMNOPQRSTUV'.split('');
// Retain the provided workbook's styles and table, replacing external links with
// source values and local, editable funding formulas. Unset amounts remain blank.
export function exportReviews(template,records){
 if(!records.length||records.length>200)throw Error('Invalid proposal count.');
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
 return Buffer.from(zipSync(zip));
}
