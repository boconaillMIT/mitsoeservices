import units from './units.cjs';
import policy from './policy.cjs';
export function accessibleUnits(result){return Object.keys(units.ALL_UNITS).filter(scope=>policy.effectiveRole(result.policy.data,result.kerberos,scope,'limited'));}
export function unitCards(result,group){
 return accessibleUnits(result).filter(scope=>!group||Object.hasOwn(group==='other'?units.OTHER_UNITS:units.UNITS,scope)).map(scope=>{
  const u=units.ALL_UNITS[scope],full=policy.effectiveRole(result.policy.data,result.kerberos,scope,'full'),limited=policy.effectiveRole(result.policy.data,result.kerberos,scope,'limited');
  return `<section class="card"><h2>${u.name}</h2>${full?`<a class="desktop" href="${units.unitPath(scope)}">${u.label} Full access →</a>`:''}${limited?`<a class="desktop" href="${units.unitPath(scope,'limited')}">${u.label} Limited Access →</a>`:''}</section>`;
 }).join('');
}
