import {renderWalletCharts} from './wallet-charts.mjs';
import {walletDateSummary} from './report-dates.mjs';
export function startBudgetWalletExtract(container,scope,{fetcher=fetch,renderer=renderWalletCharts,controller='Department'}={}){
 if(!container)return;
 const status=container.querySelector('[data-wallet-status]'),charts=container.querySelector('[data-wallet-charts]'),retry=container.querySelector('[data-wallet-retry]');
 let generation=0;
 async function load(){
  const run=++generation;retry.disabled=true;retry.hidden=true;status.textContent='Loading the published wallet extract…';
  try{
   const response=await fetcher('/.netlify/functions/unit-data?unit='+encodeURIComponent(scope),{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(20000)});
   if(!response.ok)throw Error(response.status===401?'Sign-in expired. Reload this page to sign in again.':response.status===403?'The wallet extract is not available for your current permissions.':'The published wallet extract could not be loaded. Please retry.');
   const data=await response.json();if(data?.scope!==scope||!Array.isArray(data.rows))throw Error('The wallet extract could not be verified for this unit. Please retry.');
   if(run!==generation)return;
   renderer(charts,data.rows,{controller,types:['GIB Carryforward','Expendable Fund Balance']});
   status.textContent=walletDateSummary(data);container.dataset.walletLoaded='true';
  }catch(error){if(run!==generation)return;charts.replaceChildren();container.dataset.walletLoaded='false';status.textContent=error.name==='TimeoutError'?'The wallet extract took too long to load. Please retry.':error.message;retry.hidden=false;}
  finally{if(run===generation)retry.disabled=false;}
 }
 retry.addEventListener('click',load);return load();
}
