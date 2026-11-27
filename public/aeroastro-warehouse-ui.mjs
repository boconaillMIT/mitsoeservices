export function setupWarehouseRefresh({reload}){
 const button=document.getElementById('finance-warehouse-refresh'),status=document.getElementById('finance-warehouse-status'),launch=document.getElementById('finance-warehouse-launch');if(!button)return;
 async function api(body){const r=await fetch('/.netlify/functions/aeroastro-warehouse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});let data;try{data=await r.json();}catch{throw Error('Warehouse refresh is unavailable. Please try again.');}if(!r.ok)throw Error(data.error||'Warehouse refresh is unavailable.');return data;}
 const pause=()=>new Promise(resolve=>setTimeout(resolve,5000));
 button.addEventListener('click',async()=>{
  button.disabled=true;launch.hidden=true;status.textContent='Preparing a secure AeroAstro refresh…';
  try{
   const start=await api({action:'start'});if(!/^mitsoe-warehouse:\/\/refresh\/[-_A-Za-z0-9]+\.[a-f0-9]{64}$/.test(start.launch))throw Error('The Warehouse sign-in could not be prepared.');
   launch.href=start.launch;launch.hidden=false;launch.click();status.textContent='Sign in in the Warehouse helper window. Your password is not entered on this website. Leave this page open while the accounts update.';
   for(let i=0;i<170;i++){
    await pause();const result=await api({action:'status',ticket:start.ticket});
    if(result.saved){await reload();status.textContent='AeroAstro balances and seasonal projections are updated.';launch.hidden=true;return;}
    if(result.changed)throw Error('Another refresh was saved. Reload the accounts before starting again.');
   }
   status.textContent='This refresh has expired. Start again when you are ready to sign in.';
  }catch(e){status.textContent=e.message;}finally{button.disabled=false;launch.hidden=true;launch.removeAttribute('href');}
 });
}
