import test from 'node:test';
import assert from 'node:assert/strict';
import {startBudgetWalletExtract} from './public/budget-wallet-extract.mjs';
function fixture(){const nodes={status:{textContent:''},charts:{replaceChildren(){this.cleared=true;}},retry:{hidden:true,disabled:false,addEventListener(name,callback){this.click=callback;}}};return {nodes,container:{dataset:{},querySelector:selector=>selector==='[data-wallet-status]'?nodes.status:selector==='[data-wallet-charts]'?nodes.charts:nodes.retry}};}
const payload=scope=>({scope,statement:{balance_year:2026},rows:[{type:'GIB Carryforward',year:2027,admin:'DP',amount:120},{type:'Expendable Fund Balance',year:2026,admin:'DP',amount:80}]});
test('briefing extract renders the two published histories with a protected no-store request',async()=>{
 const {container,nodes}=fixture();let request,rendered;
 await startBudgetWalletExtract(container,'meche',{fetcher:async(url,options)=>{request={url,options};return {ok:true,json:async()=>payload('meche')};},renderer:(charts,rows,options)=>{rendered={charts,rows,options};}});
 assert.equal(request.url,'/.netlify/functions/unit-data?unit=meche');assert.equal(request.options.credentials,'same-origin');assert.equal(request.options.cache,'no-store');assert.deepEqual(rendered.options.types,['GIB Carryforward','Expendable Fund Balance']);assert.equal(rendered.rows.length,2);assert.equal(container.dataset.walletLoaded,'true');assert.equal(nodes.retry.hidden,true);
});
test('a failed extract stays visible with retry and can recover without reloading notes',async()=>{
 const {container,nodes}=fixture();let attempts=0,renders=0;
 await startBudgetWalletExtract(container,'cee',{fetcher:async()=>++attempts===1?{ok:false,status:503}:{ok:true,json:async()=>payload('cee')},renderer:()=>{renders++;}});
 assert.equal(container.dataset.walletLoaded,'false');assert.equal(nodes.retry.hidden,false);assert.match(nodes.status.textContent,/retry/i);
 await nodes.retry.click();assert.equal(container.dataset.walletLoaded,'true');assert.equal(renders,1);assert.equal(nodes.retry.hidden,true);
});
test('wrong-unit data and revoked permissions never render a substitute wallet',async()=>{
 for(const response of [{ok:true,json:async()=>payload('eecs')},{ok:false,status:403}]){const {container,nodes}=fixture();let renders=0;await startBudgetWalletExtract(container,'cee',{fetcher:async()=>response,renderer:()=>renders++});assert.equal(renders,0);assert.equal(nodes.retry.hidden,false);assert.equal(container.dataset.walletLoaded,'false');}
});
