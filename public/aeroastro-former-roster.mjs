const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createFormerRoster({getData,request,reload,personClick}){
 const pages={former:1,deleted:1},$=id=>document.getElementById(id);let busy=false,latest,pending;
 function render(filtered,rowHtml,header,colCount){
  latest=[filtered,rowHtml,header,colCount];
  for(const type of ['former','deleted']){
   const deleted=type==='deleted',rows=filtered.filter(r=>r.inCurrentRoster===false&&Boolean(r.deletedAt)===deleted),count=Math.max(1,Math.ceil(rows.length/20));pages[type]=Math.min(pages[type],count);
   if(deleted)$('finance-deleted-count').textContent=`Deleted records (${rows.length})`;
   const extra=deleted?'Deleted by / date':'Last reported',action=getData().canManagePeople;
   const tableHead=header.replace('</th>','</th>'+(action?'<th scope="col">'+(deleted?'Restore':'Remove')+'</th>':'')).replace('</tr>',`<th scope="col">${extra}</th></tr>`);
   const body=rows.slice((pages[type]-1)*20,pages[type]*20).map(row=>rowHtml(row).replace('</td>','</td>'+(action?`<td><button type="button" data-person-operation="${deleted?'restore':'delete'}" data-person-id="${esc(row.id)}" ${busy?'disabled':''}>${deleted?'Restore':'Delete record'}</button></td>`:'')).replace(/<\/tr>$/,`<td>${deleted?esc(row.deletedBy)+'@mit.edu · '+esc(new Date(row.deletedAt).toLocaleString('en-US',{timeZone:'America/New_York'}))+' Eastern':esc(row.lastSeenDate||getData().source?.asOf||'—')}</td></tr>`)).join('')||`<tr><td colspan="${colCount+1+(action?1:0)}">No matching ${deleted?'deleted records':'appointments missing from the latest roster'}.</td></tr>`;
   $('finance-'+type+'-list').innerHTML=`<p>${rows.length} ${deleted?'deleted':'former'} appointment${rows.length===1?'':'s'}</p><div class="wallet-table"><table><thead>${tableHead}</thead><tbody>${body}</tbody></table></div><p><button type="button" data-page="${type}" data-delta="-1" ${pages[type]===1?'disabled':''}>Previous</button> Page ${pages[type]} of ${count} <button type="button" data-page="${type}" data-delta="1" ${pages[type]===count?'disabled':''}>Next</button></p>`;
  }
 }
 $('finance-former-section').addEventListener('click',async e=>{
  const pager=e.target.closest('[data-page]');if(pager){pages[pager.dataset.page]+=Number(pager.dataset.delta);render(...latest);return;}
  const sort=e.target.closest('[data-sort]');if(sort){document.querySelector('#finance-head [data-sort="'+sort.dataset.sort+'"]').click();return;}
  if(e.target.closest('[data-record-cancel]')){pending=null;$('finance-record-confirm').hidden=true;return;}
  const confirmButton=e.target.closest('[data-record-confirm]'),button=e.target.closest('[data-person-operation]');if(!button&&!confirmButton){personClick(e);return;}
  if(busy||!getData().canManagePeople)return;
  const operation=confirmButton?pending?.operation:button.dataset.personOperation,id=confirmButton?pending?.id:button.dataset.personId,person=getData().rows.find(r=>r.id===id);if(!person)return;
  const text=operation==='delete'?`Delete ${person.name}’s former appointment record (${person.position||person.jobTitle}) from this list? It can be restored under Deleted records. Private notes and history will be retained.`:`Restore ${person.name}’s former appointment record?`;
  if(!confirmButton){pending={operation,id};$('finance-record-confirm-text').textContent=text;$('finance-record-confirm').hidden=false;$('finance-record-confirm').scrollIntoView({behavior:'smooth',block:'nearest'});return;}
  pending=null;$('finance-record-confirm').hidden=true;
  busy=true;render(...latest);$('finance-record-status').textContent='Saving…';
  try{await request('personnel-records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation,id,version:getData().version})});await reload();$('finance-record-status').textContent=operation==='delete'?'Record moved to Deleted records. Private notes are preserved.':'Record restored to Not on latest roster.';}
  catch(error){$('finance-record-status').textContent=error.message;}
  finally{busy=false;render(...latest);}
 });
 const panel=document.createElement('div');panel.id='finance-record-confirm';panel.className='finance-record-confirm';panel.hidden=true;panel.innerHTML='<p id="finance-record-confirm-text"></p><button type="button" data-record-confirm>Confirm</button> <button type="button" data-record-cancel>Cancel</button>';$('finance-former-section').insertBefore(panel,$('finance-former-list'));
 return {render};
}
