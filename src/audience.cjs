const policy=require('./policy.cjs');
const {unitPath}=require('./units.cjs');
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function pageAudience(data,scope,audience='full'){
 if(!Array.isArray(data?.grants)||!Object.hasOwn(policy.SCOPES,scope)||!['full','limited'].includes(audience))throw Error('Audience unavailable');
 return [...new Set(data.grants.map(g=>g.username))].sort().flatMap(username=>{
  const role=policy.effectiveRole(data,username,scope,audience);
  return policy.CAPABILITIES[role]>=policy.CAPABILITIES.read?[{username,role,inherited:Boolean(policy.effectiveRole(data,username,'school',audience))}]:[];
 });
}
function audienceHtml(data,scope,section,resourceScope=scope){
 const audience=section==='limited'?'limited':'full',people=pageAudience(data,scope,audience);
 if(!people.length)throw Error('Audience unavailable');
 const url='https://mitsoeservices.netlify.app'+unitPath(resourceScope,section);
 const subject='URGENT: MITSOEServices access concern — '+policy.SCOPES[scope];
 const body='Please review access to this page urgently:\r\n'+url+'\r\n\r\nWhat looks wrong:\r\n';
 const href='mailto:oconaill@mit.edu,juliekuk@mit.edu?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
 return `<section class="audience-panel" aria-label="Who can view this page"><h2>Who can view this page (${people.length})</h2><p>Everyone listed can read this page, including people with write or administrator permissions.</p><ul>${people.map(p=>`<li><strong>${escape(p.username)}@mit.edu</strong> — ${escape(policy.roleLabels(scope)[p.role])}${p.inherited?' <span class="audience-inherited">(includes school-wide access)</span>':''}</li>`).join('')}</ul><p>If this looks wrong, please <a class="access-concern" href="${escape(href)}">click here</a> to report an urgent access concern to Brian O’Conaill and Julie Kukharenko.</p><p class="small">Permissions checked when this page opened. Reload to see subsequent changes.</p></section>`;
}
module.exports={pageAudience,audienceHtml};
