import {createNotebook,unlockNotebook,encryptPrivateNote,decryptPrivateNote} from './aeroastro-private-crypto.mjs';
import {PRIVATE_OWNER,PERSON_KEY,validateVault} from './aeroastro-private-schema.mjs';
const envelope=n=>({schema:n.schema,vaultId:n.vaultId,id:n.id,iv:n.iv,ciphertext:n.ciphertext});
const IDLE_MS=10*60*1000;
export async function createPrivatePeopleNotes(root,permission){
 root.className='card private-person-notes';root.innerHTML=`<h2>Private person notes · Tara only</h2><p>Your browser encrypts these notes using a separate notebook passphrase. The passphrase and readable note text are never sent to the site. School administrators cannot open this notebook through the site or recover a forgotten passphrase.</p><p>Use a unique passphrase of at least 20 characters, separate from your MIT password. Keep it somewhere safe. You will need it again after locking, refreshing, or opening another device.</p><p id="private-vault-status" role="status">Checking your encrypted notebook…</p><div id="private-vault-unlock" hidden><label>Notebook passphrase<input id="private-passphrase" type="password" autocomplete="current-password" maxlength="1000" autocapitalize="none" spellcheck="false"></label><div id="private-vault-setup" hidden><label>Confirm notebook passphrase<input id="private-confirm" type="password" autocomplete="new-password" maxlength="1000" autocapitalize="none" spellcheck="false"></label><label><input id="private-understand" type="checkbox"> I understand that a forgotten passphrase cannot be reset to recover these notes.</label></div><button type="button" id="private-unlock-button" disabled>Unlock notebook</button></div><button type="button" id="private-lock-button" hidden>Lock notebook</button><p class="small">The notebook locks when you leave this tab or after 10 minutes without activity. Locking preserves an unsaved draft in encrypted memory while this page remains open; closing the page discards unsaved drafts. Private notes are excluded from shared views and printing.</p><section id="private-person-section" hidden><h3 id="private-person-title"></h3><p id="private-person-status" role="status"></p><div id="private-person-records"></div><div id="private-note-editor" hidden><label>New private note<textarea id="private-person-text" rows="5" maxlength="6000"></textarea></label><button type="button" id="private-save-button">Encrypt and save private note</button></div></section>`;
 const $=id=>root.querySelector('#'+id),pass=$('private-passphrase'),confirm=$('private-confirm'),text=$('private-person-text'),records=$('private-person-records');
 let vault=null,key=null,selected=null,busy=false,locking=false,epoch=0,selection=0,timer=null,prepared=null,lockPending=Promise.resolve();const drafts=new Map();
 function message(value){$('private-vault-status').textContent=value;}
 function clearPass(){pass.value='';confirm.value='';$('private-understand').checked=false;}
 function clearPlain(){records.replaceChildren();text.value='';prepared=null;}
 function controls(){
  $('private-vault-unlock').hidden=Boolean(key);$('private-vault-setup').hidden=Boolean(vault);$('private-lock-button').hidden=!key;
  $('private-unlock-button').textContent=vault?'Unlock notebook':'Create encrypted notebook';$('private-unlock-button').disabled=busy||locking||(!vault&&!permission.canWrite);
  pass.disabled=busy||locking;confirm.disabled=busy||locking;$('private-understand').disabled=busy||locking;
  $('private-note-editor').hidden=!key||!selected||!permission.canWrite;$('private-save-button').disabled=busy||locking;text.disabled=busy||locking;
 }
 async function api(path,body){
  let response;try{response=await fetch('/units/aeroastro/finance/private-notes'+path,{method:body?'POST':'GET',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)});}catch{throw Error('The encrypted notebook could not be reached. Retry; existing notes are unchanged.');}
  if(response.status===401||response.status===403){await lock('Notebook locked. Sign in again to verify your private-note access.');throw Error('Private notebook access could not be verified.');}
  const data=await response.json();if(!response.ok)throw Error(data.error||'The encrypted notebook could not be saved.');return data;
 }
 function touch(){clearTimeout(timer);if(key)timer=setTimeout(()=>{void lock('Notebook locked after 10 minutes without activity.');},IDLE_MS);}
 async function stashDraft(){
  if(!key||!selected||!text.value.trim())return;const localKey=key,person=selected.personKey,value=text.value,existing=prepared,vid=vault.vaultId;text.value='';
  const sealed=existing||await encryptPrivateNote(localKey,vid,person,value);drafts.set(person,sealed);
 }
 async function lock(reason='Notebook locked.'){
  const preserve=stashDraft();epoch++;selection++;key=null;clearTimeout(timer);clearPass();clearPlain();locking=true;controls();if(selected)$('private-person-status').textContent='Unlock the notebook to read this person’s private notes.';
  lockPending=preserve.catch(()=>{reason='Notebook locked. The unsaved draft could not be preserved.';});await lockPending;locking=false;controls();message(reason);
 }
 async function showPerson(){
  if(!selected)return;$('private-person-section').hidden=false;$('private-person-title').textContent=selected.name+' · private notes';
  if(!key){$('private-person-status').textContent='Unlock your notebook to read or add private notes.';return;}
  const at=epoch,person=selected.personKey,localKey=key,vid=vault.vaultId;records.replaceChildren();$('private-person-status').textContent='Unlocking this person’s saved notes…';
  try{const result=await api('?op=notes&person='+person);const fragment=document.createDocumentFragment();
   for(const note of result.notes){if(note.personKey!==person||note.by!==PRIVATE_OWNER||!Number.isFinite(Date.parse(note.at)))throw Error('A private note could not be verified.');const plain=await decryptPrivateNote(localKey,vid,person,envelope(note));if(at!==epoch||selected?.personKey!==person||!key)return;const article=document.createElement('article'),stamp=document.createElement('strong'),p=document.createElement('p');stamp.textContent=note.by+'@mit.edu · '+new Date(note.at).toLocaleString('en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'})+' Eastern';p.textContent=plain;article.append(stamp,p);fragment.append(article);}
   if(at!==epoch||selected?.personKey!==person||!key)return;records.replaceChildren(fragment);$('private-person-status').textContent=result.notes.length?'Only you can unlock these saved notes.':'No private notes saved for this person.';
   const cached=drafts.get(person);if(cached){const value=await decryptPrivateNote(localKey,vid,person,cached);if(at!==epoch||selected?.personKey!==person||!key)return;text.value=value;prepared=cached;$('private-person-status').textContent+=' Your unsaved draft has been restored.';}
   controls();touch();
  }catch(e){if(at===epoch&&key){records.replaceChildren();$('private-person-status').textContent=e.message;}}
 }
 async function select(person){
  if(!PERSON_KEY.test(person.personKey||''))return;if(busy||locking){message('Finish the current notebook operation before changing person.');return;}
  if(selected?.personKey===person.personKey){await stashDraft();clearPlain();await showPerson();root.scrollIntoView({behavior:'smooth',block:'start'});return;}
  const change=++selection,at=epoch;await stashDraft();if(change!==selection||at!==epoch)return;selected={personKey:person.personKey,name:person.name};epoch++;clearPlain();controls();await showPerson();root.scrollIntoView({behavior:'smooth',block:'start'});
 }
 $('private-unlock-button').addEventListener('click',async()=>{
  if(busy||locking)return;const value=pass.value;
  if(!vault&&(value.normalize('NFC')!==confirm.value.normalize('NFC')||!$('private-understand').checked)){message('Confirm the same passphrase and acknowledge that it cannot be recovered.');return;}
  busy=true;const at=++epoch;controls();message(vault?'Unlocking your notebook…':'Encrypting your new notebook key…');
  try{await lockPending;let candidate;if(vault)candidate=await unlockNotebook(value,vault);else{const created=await createNotebook(value);const saved=await api('',{action:'create-vault',vault:created.vault});const checked=validateVault(saved.vault);if(JSON.stringify(checked)!==JSON.stringify(created.vault))throw Error('A different notebook already exists. Unlock it with its original passphrase.');vault=checked;candidate=created.key;}
   if(at!==epoch)return;key=candidate;message('Notebook unlocked on this page.');touch();
  }catch(e){if(at===epoch){key=null;message(e.message);try{const latest=await api('?op=vault');vault=latest.vault?validateVault(latest.vault):null;}catch{}}}
  finally{clearPass();busy=false;controls();}
  if(key&&at===epoch)await showPerson();
 });
 $('private-lock-button').addEventListener('click',()=>{void lock();});
 text.addEventListener('input',()=>{prepared=null;if(selected)drafts.delete(selected.personKey);touch();});
 $('private-save-button').addEventListener('click',async()=>{
  if(!key||!selected||busy||locking||!permission.canWrite||!text.value.trim())return;const person=selected.personKey,localKey=key,vid=vault.vaultId,value=text.value,at=epoch;busy=true;controls();$('private-person-status').textContent='Encrypting the note in your browser…';
  try{const note=prepared||await encryptPrivateNote(localKey,vid,person,value);if(at!==epoch||!key)return;prepared=note;await api('',{action:'append',personKey:person,note});if(drafts.get(person)?.id===note.id)drafts.delete(person);
   if(at!==epoch||!key)return;text.value='';prepared=null;drafts.delete(person);await showPerson();$('private-person-status').textContent='Encrypted private note saved. Only your notebook passphrase can unlock its content.';
  }catch(e){if(at===epoch&&key)$('private-person-status').textContent=e.message+' Your unsaved draft remains here.';}
  finally{busy=false;controls();touch();}
 });
 for(const input of [pass,confirm])input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('private-unlock-button').click();}});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)void lock('Notebook locked when you left this tab.');});window.addEventListener('pagehide',()=>{void lock();});window.addEventListener('beforeprint',()=>{void lock('Notebook locked for printing.');});window.addEventListener('beforeunload',e=>{if(text.value.trim()||drafts.size){e.preventDefault();e.returnValue='';}});window.addEventListener('pointerdown',touch,{passive:true});window.addEventListener('keydown',touch,{passive:true});
 if(!permission.ready){$('private-vault-unlock').hidden=true;message('Private notes are waiting for verified person identifiers. Existing notes are preserved.');return {available:false,select,lock};}
 try{const result=await api('?op=vault');vault=result.vault?validateVault(result.vault):null;controls();message(vault?'Notebook locked. Enter your notebook passphrase.':permission.canWrite?'Choose your own passphrase to create your encrypted notebook.':'A private notebook has not been created. Writing permission is needed for setup.');}
 catch(e){message(e.message);$('private-vault-unlock').hidden=true;return {available:false,select,lock};}
 return {available:true,select,lock};
}
