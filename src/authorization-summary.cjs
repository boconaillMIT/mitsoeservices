const policy=require('./policy.cjs');
const units=require('./units.cjs');
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function authorizationSummary(data,login,scopes=Object.keys(policy.SCOPES)){
 const username=policy.normalizeLogin(login);if(!username)return [];
 return scopes.flatMap(scope=>{
  if(scope.startsWith('budget:')&&!data.grants.some(g=>g.username===username&&g.scope===scope))return [];
  const full=policy.effectiveRole(data,username,scope),role=full||policy.effectiveRole(data,username,scope,'limited');if(!role)return [];
  const direct=data.grants.find(g=>g.username===username&&g.scope===scope),school=data.grants.find(g=>g.username===username&&g.scope==='school');
  const inherited=scope!=='school'&&school&&policy.effectiveRole({grants:[school]},username,scope,full?'full':'limited')===role;
  const href=scope==='school'?'/soe-hq':scope==='rct'?'/soe-hq/rct-review':scope.startsWith('budget:')?'/soe-hq/budget/fy28/'+scope.slice(7):units.unitPath(scope,full?'full':'limited');
  const label=scope.startsWith('budget:')?(role==='admin'?'Administrator (school-wide)':role==='write'?'Read & edit (school-wide access)':'Budget viewer (read only)'):policy.roleLabels(scope)[role]||role;
  return [{scope,name:policy.SCOPES[scope],role,label,href,source:inherited?'School-wide access':'Direct permission',directRole:direct?.role||null}];
 });
}
function authorizationsHtml(data,login,{compact=false}={}){
 const entries=authorizationSummary(data,login),groups=[['School & RCT',e=>['school','rct'].includes(e.scope)],['Department budgets',e=>e.scope.startsWith('budget:')],['Unit resources',e=>!['school','rct'].includes(e.scope)&&!e.scope.startsWith('budget:')]];
 return `<section class="card my-authorizations"><div class="eyebrow">YOUR ACCESS</div><h2>${compact?'My authorizations':'Current permissions'}</h2><p>Signed in as <strong>${escape(login)}@mit.edu</strong>. Your current access is shown below.</p>${compact?`<div class="authorization-grid">${entries.filter(e=>data.grants.some(g=>g.username===policy.normalizeLogin(login)&&g.scope===e.scope)).map(e=>`<article class="authorization-item"><h3>${escape(e.name)}</h3><p>${escape(e.label)}</p></article>`).join('')}</div><p><a class="desktop" href="/my-authorizations">See all my authorizations →</a></p>`:groups.map(([name,match])=>{const list=entries.filter(match);return list.length?`<h2>${name}</h2><div class="authorization-grid">${list.map(e=>`<article class="authorization-item"><h3><a href="${escape(e.href)}">${escape(e.name)}</a></h3><p><strong>${escape(e.label)}</strong></p><p class="small">${escape(e.source)}${e.directRole&&e.source==='School-wide access'?' · also has a direct '+escape(policy.roleLabels(e.scope)[e.directRole]||e.directRole)+' grant':''}</p></article>`).join('')}</div>`:'';}).join('')}<p class="small">Access is checked on each request. Resource visibility settings may temporarily hide a page. External document sharing is managed separately.</p></section>`;
}
module.exports={authorizationSummary,authorizationsHtml};
