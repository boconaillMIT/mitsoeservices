const {ALL_UNITS}=require('./units.cjs');
const BUDGET_UNITS=Object.freeze({...Object.fromEntries(Object.entries(ALL_UNITS).filter(([key])=>!['soe-fake','school'].includes(key)).map(([key,unit])=>[key,unit.name])),'x-neet':'NEET','x-mites':'MITES'});
const budgetScope=unit=>'budget:'+unit;
const BUDGET_SCOPES=Object.freeze(Object.fromEntries(Object.entries(BUDGET_UNITS).map(([key,name])=>[budgetScope(key),'Budget viewer — '+name])));
function budgetViewerUnits(data,username){return [...new Set((data?.grants||[]).filter(g=>g.username===username&&g.role==='read'&&Object.hasOwn(BUDGET_SCOPES,g.scope)).map(g=>g.scope.slice(7)))].sort();}
module.exports={BUDGET_UNITS,BUDGET_SCOPES,budgetScope,budgetViewerUnits};
