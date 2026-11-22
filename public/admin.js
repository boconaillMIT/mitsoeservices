const endpoint='/.netlify/functions/admin-access';
const status=document.querySelector('#status'),form=document.querySelector('#add-user');
let version='',busy=false,policy=null;
function controls(disabled){busy=disabled;for(const el of document.querySelectorAll('button,input,select'))el.disabled=disabled;}
function roleOptions(){const current=form.elements.role.value,labels=policy?.roleLabels?.[form.elements.scope.value]||{};form.elements.role.replaceChildren(...Object.entries(labels).map(([key,label])=>new Option(label,key)));if(Object.hasOwn(labels,current))form.elements.role.value=current;}
function cell(value){const el=document.createElement('td');el.textContent=value;return el;}
function render(data){
 policy=data;const selected=form.elements.scope.value;
 form.elements.scope.replaceChildren(...Object.entries(data.scopes).map(([scope,name])=>new Option(name,scope)));
 if(Object.hasOwn(data.scopes,selected))form.elements.scope.value=selected;roleOptions();
 version=data.version;const list=document.querySelector('#users');list.replaceChildren();
 for(const grant of data.grants){
  const row=document.createElement('tr'),actions=cell('');row.append(cell(grant.username),cell(data.scopes[grant.scope]),cell(data.roleLabels[grant.scope][grant.role]),actions);
  if((data.protectedAdmins||[]).includes(grant.username))actions.textContent='Recovery administrator';
  else{
   const edit=document.createElement('button');edit.textContent='Edit';edit.onclick=()=>{form.elements.username.value=grant.username;form.elements.scope.value=grant.scope;roleOptions();form.elements.role.value=grant.role;form.elements.username.focus();status.textContent='Editing '+grant.username+'. Choose an access level and save.';};
   const remove=document.createElement('button');remove.textContent='Remove';remove.onclick=()=>change('remove',grant.username,grant.scope,grant.role);actions.append(edit,remove);
  }list.append(row);
 }
 const audit=document.querySelector('#audit');audit.replaceChildren();
 for(const entry of [...data.audit].reverse()){const li=document.createElement('li');li.textContent=`${entry.at} · ${entry.actor} · ${entry.action} · ${entry.username||''} ${entry.scope?('· '+(data.scopes[entry.scope]||entry.scope)):''} ${entry.role?('· '+(data.roleLabels[entry.scope]?.[entry.role]||entry.role)):''}`;audit.append(li);}
 if(!data.audit.length){const li=document.createElement('li');li.textContent='No access changes yet.';audit.append(li);}
}
async function load(){controls(true);try{const r=await fetch(endpoint,{credentials:'same-origin',cache:'no-store'});const data=await r.json();if(!r.ok)throw Error(data.error||'Unable to load permissions.');render(data);status.textContent='Permissions are current.';}catch(e){version='';status.textContent=e.message;}finally{controls(false);}}
async function change(action,username,scope,role){
 if(busy||!version)return;
 const label=policy.roleLabels[scope]?.[role]||role;
 if(!window.confirm(`${action==='remove'?'Remove':'Save'} ${label} for ${username} (${policy.scopes[scope]})?`))return;
 controls(true);try{const r=await fetch(endpoint,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,username,scope,role,version})});const data=await r.json();if(!r.ok)throw Error(data.error||'Unable to save permission.');render(data);status.textContent=Object.keys(data.scopes).length?'Permission saved.':'Permission saved. Your access-management rights have been removed.';}catch(e){version='';status.textContent=e.message+' Reload permissions before retrying.';}finally{controls(false);}
}
form.elements.scope.addEventListener('change',roleOptions);
form.addEventListener('submit',e=>{e.preventDefault();change('add',form.elements.username.value.trim().toLowerCase(),form.elements.scope.value,form.elements.role.value);});
await load();


const lookup=document.querySelector('#lookup-user'),lookupResults=document.querySelector('#lookup-results');
lookup.addEventListener('submit',async event=>{
 event.preventDefault();const login=document.querySelector('#lookup-login').value.trim();lookupResults.textContent='Checking current authorizations…';
 try{const response=await fetch(endpoint+'?username='+encodeURIComponent(login),{credentials:'same-origin',cache:'no-store'}),data=await response.json();if(!response.ok)throw Error(data.error||'Unable to look up access.');
 lookupResults.replaceChildren();const heading=document.createElement('h3');heading.textContent=data.username+'@mit.edu';lookupResults.append(heading);
 if(data.limitedToManagedAreas){const note=document.createElement('p');note.textContent='Showing only the areas you administer.';lookupResults.append(note);}
 if(!data.authorizations.length){const note=document.createElement('p');note.textContent='No authorizations'+(data.limitedToManagedAreas?' in the areas you administer.':'.');lookupResults.append(note);}
 const grid=document.createElement('div');grid.className='authorization-grid';for(const entry of data.authorizations){const card=document.createElement('article');card.className='authorization-item';const title=document.createElement('h4');title.textContent=entry.name;const role=document.createElement('p');role.textContent=entry.label;const source=document.createElement('p');source.className='small';source.textContent=entry.source+(entry.directRole&&entry.source==='School-wide access'?' · also has a direct grant':'');card.append(title,role,source);grid.append(card);}lookupResults.append(grid);
 }catch(error){lookupResults.textContent=error.message;}
});
