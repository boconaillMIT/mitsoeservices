// Department priorities are scoped to the supplied unit and fiscal year.
export function requestRevision(request,unit,year){
 const r=request.source?.request_revision;
 return r&&r.schema===1&&r.unit===unit&&r.year===year&&Number.isInteger(r.priority)&&r.priority>=1&&r.priority<=100&&/^\d{4}-\d{2}-\d{2}$/.test(r.date||'')&&typeof r.note==='string'&&r.note.length<=2000?r:null;
}
export function compareRequestPriority(a,b){return (a.priority??Infinity)-(b.priority??Infinity)||(b.requested??0)-(a.requested??0);}
export function revisionHtml(r){if(!r)return '';const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));return '<p class="bv-status"><strong>Department priority '+r.priority+'</strong> · '+esc(r.date)+(r.note?'<br>'+esc(r.note):'')+'</p>';}
