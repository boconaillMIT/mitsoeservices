import access from './access.cjs';
import policy from './policy.cjs';
import units from './units.cjs';
import {accessibleUnits,unitCards} from './unit-cards.mjs';
import {hubLayout} from './unit-hub.mjs';

export function createMyUnitHandler(authorize=access.authorize){return async event=>{
 if(event.httpMethod!=='GET')return {statusCode:405,headers:{...access.noStore,Allow:'GET'},body:'GET required.'};
 const result=await authorize(event,{scope:'any',audience:'limited'});
 if(result.statusCode===401)return {statusCode:302,headers:{...access.noStore,Location:'/.netlify/functions/auth-login?returnTo=%2Fmy-unit'},body:''};
 if(!result.user)return result;
 try{
  // Use the effective policy, including any active restriction to the test unit.
  // Never derive the target from the URL, a unit name, or the user's email.
  if(policy.effectiveRole(result.policy.data,result.kerberos,'school','limited'))return {statusCode:302,headers:{...access.noStore,Location:'/?home=1'},body:''};
  const allowed=accessibleUnits(result);
  if(allowed.length===1){const scope=allowed[0],audience=policy.effectiveRole(result.policy.data,result.kerberos,scope,'full')?'full':'limited';return {statusCode:302,headers:{...access.noStore,Location:units.unitPath(scope,audience)},body:''};}
  if(!allowed.length)return {statusCode:403,headers:access.noStore,body:'No unit access is assigned to this login. Contact a site administrator.'};
  return {statusCode:200,headers:{...access.noStore,'Content-Type':'text/html; charset=utf-8'},body:hubLayout('Your units','<div class="unit-directory">'+unitCards(result)+'</div>',result.canManage,'',result.admin,result.schoolAccess,result.navigation)};
 }catch{return {statusCode:503,headers:access.noStore,body:'Your unit access could not be verified. Please try again later.'};}
};}
export const handler=createMyUnitHandler();
