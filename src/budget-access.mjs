import access from './access.cjs';
import scopes from './budget-scopes.cjs';
export async function authorizeBudget(event,{authorize=access.authorize,writing=false,unit=null}={}){
 const wide=await authorize(event,{scope:'school',minimum:writing?'write':'read'});
 if(wide.user&&!wide.statusCode)return {...wide,budgetRestricted:false};
 if(wide.statusCode!==403||writing)return wide;
 const result=await authorize(event,{scope:'any',minimum:'read'});
 if(!result.user||result.statusCode)return result;
 // Use the effective policy so an administrator's restrictive test view cannot
 // recover access through their real grants.
 const allowed=scopes.budgetViewerUnits(result.policy?.data,result.kerberos);
 if(!allowed.length||unit&&!allowed.includes(unit))return {statusCode:403,headers:access.noStore,body:'You do not have budget access to this department.'};
 return {...result,role:'read',canWrite:false,admin:false,canManage:false,managedScopes:[],schoolAccess:false,budgetRestricted:true,budgetUnits:allowed,features:{...result.features,wallets:false},navigation:{...result.navigation,budget:true}};
}
