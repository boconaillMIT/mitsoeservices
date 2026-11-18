(()=>{'use strict';
 const $=q=>document.querySelector(q),unit=document.body.dataset.fileUnit,audience=document.body.dataset.fileAudience,endpoint='/.netlify/functions/unit-files?'+new URLSearchParams({unit,audience});let busy=false;
 const node=(tag,text)=>{const n=document.createElement(tag);n.textContent=String(text??'');return n;};
 const size=value=>value<1024?value+' B':value<1024*1024?(value/1024).toFixed(1)+' KB':(value/1024/1024).toFixed(1)+' MB';
 async function request(body){const r=await fetch(endpoint,{credentials:'same-origin',cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});let value;try{value=await r.json();}catch{throw Error(r.status===401?'Please sign in again.':r.status===403?'Your access to this page has changed. Reload the page.':'The file request could not be completed.');}if(!r.ok)throw Error(value.error||'The file request could not be completed.');return value;}
 function accessCell(file){
  const td=document.createElement('td'),label=audience==='full'?'Full Access':'Limited Access';td.append(node('span',label));
  const latest=file.access_history?.at(-1);if(latest)td.append(node('p','Changed by '+latest.by+'@mit.edu on '+new Date(latest.at).toLocaleString('en-US',{timeZone:'America/New_York'})));
  if(!file.canChangeAccess)return td;
  const to=audience==='full'?'limited':'full',target=to==='limited'?'Limited Access':'Full Access',details=document.createElement('details'),summary=node('summary','Change access'),warning=node('p','Move this file to '+target+' for this same unit. Everyone with '+target+' can read it. The uploader and original upload date are retained.'),button=node('button','Confirm move to '+target),message=node('p','');button.type='button';
  button.addEventListener('click',async()=>{if(busy)return;busy=true;button.disabled=true;try{await request({action:'move',id:file.id,to,version:file.accessVersion});await load();$('#unit-files-status').textContent='Moved '+file.filename+' to '+target+' for this unit.';}catch(error){message.textContent=error.message;button.disabled=false;}finally{busy=false;}});
  details.append(summary,warning,button,message);td.append(details);return td;
 }
 async function load(){
  const data=await request();if(data.unit!==unit||data.audience!==audience)throw Error('The file list could not be verified for this page.');
  $('#unit-file-list').replaceChildren(...data.files.map(file=>{
   const tr=document.createElement('tr'),name=document.createElement('td'),link=node('a',file.filename);link.href=endpoint+'&action=download&id='+encodeURIComponent(file.id);name.append(link);
   const who=file.uploader_name?file.uploader_name+' ('+file.uploaded_by+'@mit.edu)':file.uploaded_by+'@mit.edu',when=document.createElement('td'),date=node('time',new Date(file.uploaded_at).toLocaleString('en-US',{timeZone:'America/New_York',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}));date.dateTime=file.uploaded_at;when.append(date);tr.append(name,node('td',size(file.size)),node('td',who),when,accessCell(file));return tr;
  }));
  $('#unit-files-status').textContent=data.files.length?data.files.length+' '+(data.files.length===1?'file':'files')+' shared on this page.':'No files have been uploaded to this page yet.';
  const form=$('#unit-file-upload');if(form){form.hidden=!data.canUpload;for(const control of form.querySelectorAll('input,button'))control.disabled=busy||!data.canUpload;}
 }
 const form=$('#unit-file-upload');
 form?.addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;const file=$('#unit-file-input').files[0],message=$('#unit-file-upload-status');if(!file)return;if(!file.size||file.size>4*1024*1024){message.textContent='Choose a nonempty file of 4 MB or smaller.';return;}
  busy=true;for(const control of form.querySelectorAll('input,button'))control.disabled=true;message.textContent='Uploading to this page…';
  try{const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));await request({filename:file.name,content:btoa(binary)});form.reset();message.textContent='Uploaded. The file is available to everyone who can view this page.';await load();}
  catch(error){message.textContent=error.message;}
  finally{busy=false;try{await load();}catch(error){$('#unit-files-status').textContent=error.message;}}
 });
 load().catch(error=>{$('#unit-files-status').textContent=error.message;});
})();
