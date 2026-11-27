import {prepareAccountRefresh,decodeReportBytes,MAX_REPORT_BYTES} from './aeroastro-refresh-model.mjs';
export function setupAccountRefresh({getData,reload,request}){
 const $=id=>document.getElementById('finance-update-'+id);if(!$('toggle'))return;
 let busy=false,pending=null;
 const invalidate=()=>{pending=null;$('summary').hidden=true;$('summary').textContent='';$('confirm').hidden=true;$('status').textContent='';};
 const clear=()=>{invalidate();$('form').reset();$('date').value=new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'});};
 const setBusy=value=>{busy=value;for(const el of [$('file'),$('date'),$('preview'),$('confirm'),$('close'),$('toggle')])el.disabled=value;};
 const show=()=>{clear();const data=getData();$('panel').hidden=false;$('toggle').setAttribute('aria-expanded','true');$('centers').textContent=data?.rows?.length?'Profit centers: '+[...new Set(data.rows.map(r=>String(r.profitCenter).replace(/^P/,'')))].sort().join(', '):'Wait for the current account list to load before preparing the report.';$('file').focus();};
 $('toggle').addEventListener('click',()=>{if(busy)return;if($('panel').hidden)show();else{clear();$('panel').hidden=true;$('toggle').setAttribute('aria-expanded','false');}});
 $('close').addEventListener('click',()=>{if(busy)return;clear();$('panel').hidden=true;$('toggle').setAttribute('aria-expanded','false');$('toggle').focus();});
 for(const id of ['file','date'])$(id).addEventListener('change',invalidate);
 $('form').addEventListener('submit',async event=>{event.preventDefault();if(busy)return;invalidate();setBusy(true);try{
  const file=$('file').files[0],data=getData(),asOf=$('date').value;if(!file||!file.name.toLowerCase().endsWith('.csv')||file.size>MAX_REPORT_BYTES)throw Error('Choose a CSV report smaller than 2 MB.');
  const csv=decodeReportBytes(await file.arrayBuffer());prepareAccountRefresh(csv,{unit:data?.unit,asOf:data?.source?.asOf,rows:data?.currentAvailable?data.rows:null},asOf);
  const preview=await request('refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'preview',csv,asOf})});
  pending={csv,asOf,issued:preview.issued,confirmation:preview.confirmation};const s=preview.summary,money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
  $('summary').textContent=`${s.reported} ${s.reported===1?'account':'accounts'} reported; ${s.changed} changed. Current balances: ${money(s.currentBalance)}. Fiscal-year expenses: ${money(s.ytdExpenses)}. SAP commitments: ${money(s.commitments)}. These totals cover all controls in the uploaded report.`;$('summary').hidden=false;$('confirm').hidden=false;$('status').textContent='Preview only. Nothing has been saved. Confirm when these totals match your report.';
 }catch(e){$('status').textContent=e.message;}finally{setBusy(false);}});
 $('confirm').addEventListener('click',async()=>{if(busy||!pending)return;setBusy(true);try{const result=await request('refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'commit',...pending})});clear();await reload();$('status').textContent=`Shared account balances updated by ${result.publishedBy}@mit.edu · ${new Date(result.publishedAt).toLocaleString('en-US',{timeZone:'America/New_York'})} Eastern.`;}catch(e){pending=null;$('confirm').hidden=true;$('status').textContent=e.message;}finally{setBusy(false);}});
 clear();
}
