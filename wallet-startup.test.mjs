import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

for(const version of ['legacy','current'])test('wallet and comparison start with '+version+' optional purpose module',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'wallet-startup-'));
 try{
  for(const name of ['wallet.js','wallet-comparison.mjs','wallet-comparison-model.mjs','budget-submission.mjs','wallet-reconciliation.mjs'])await writeFile(join(directory,name==='wallet.js'?'wallet.mjs':name),await readFile(new URL('./public/'+name,import.meta.url)));
  await writeFile(join(directory,'wallet-purpose-view.mjs'),version==='legacy'?'export function initPurposeView(){}':'export function startOptionalPurposeView(){}');
  await writeFile(join(directory,'report-dates.mjs'),'export const walletDateSummary=()=>"Example date";');
  await writeFile(join(directory,'wallet-table.mjs'),'export const walletRows=()=>[],numericAmount=()=>null,closedAccount=()=>false;');
  await writeFile(join(directory,'wallet-charts.mjs'),'export function renderWalletCharts(){};export const historyPoints=()=>[];');
  const script=`
   import assert from 'node:assert/strict';
   const nodes=new Map();globalThis.document={body:{dataset:{wallet:'school'}},querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{listeners:[],addEventListener(name,callback){this.listeners.push(name);},replaceChildren(){},hidden:false,textContent:''});return nodes.get(selector);}};
   let requested=0;globalThis.fetch=async url=>{if(!String(url).includes('action=submission'))requested++;return {ok:false,status:403};};
   await import(${JSON.stringify(pathToFileURL(join(directory,'wallet.mjs')).href)});
   assert.equal(requested,1,'main wallet loader must run');
   assert(nodes.get('#wallet-compare').listeners.includes('click'),'comparison button must be wired');
   assert.match(nodes.get('#wallet-status').textContent,/does not have access/,'loader must reach its error handling');
  `;
  const child=spawnSync(process.execPath,['--input-type=module','--eval',script],{encoding:'utf8',timeout:10000,windowsHide:true});
  assert.equal(child.status,0,child.stderr||child.stdout);
 }finally{await rm(directory,{recursive:true,force:true});}
});
