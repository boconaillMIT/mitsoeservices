import {loadBudgetRecords} from './budget-explorer.mjs';
import {mapRecord} from '../public/budget-model.mjs';
import {latestSubmission} from '../public/budget-submission.mjs';
import mapping from './unit-name-mapping.cjs';
let cache=null;
export async function loadSubmissionOutlooks({load=loadBudgetRecords,now=Date.now(),cacheMs=60000}={}){
 if(load===loadBudgetRecords&&!process.env.NIMBUS_QB_TOKEN)return {};
 if(load===loadBudgetRecords&&cache&&now-cache.at<cacheMs)return cache.data;
 const {selected,raw}=await load(),rows=raw.map(row=>mapRecord(Object.fromEntries(selected.map(f=>[f.label,row[String(f.id)]?.value??null]))));
 const scopes=[...new Set(rows.flatMap(r=>(r.source?.submissions||[]).map(s=>s.unit)))],data={};
 for(const unit of scopes){const own=rows.filter(r=>mapping.scopeFor(r.unit)===unit),s=latestSubmission(own,unit);if(s)data[unit]=s;}
 if(load===loadBudgetRecords)cache={at:now,data};return data;
}
