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
