const {createAuth} = require('./mit-sso.cjs');
const policy = require('./policy.cjs');
const units = require('./units.cjs');
const testView = require('./test-view.cjs');
const features = require('./features.cjs');
const auth = createAuth();
const noStore = {'Cache-Control':'private, no-store', 'Vary':'Cookie'};
async function authorize(event, {reader = auth.readSession, load = policy.loadPolicy, loadFeatures=features.loadFlags, scope='school', minimum='read',audience='full'} = {}) {
  let user;
  try { user = await reader(event); }
  catch { return {statusCode:503, headers:noStore, body:'MIT sign-in setup is incomplete. Contact the site administrator.'}; }
  if (!user) return {statusCode:401, headers:noStore, body:'MIT sign-in required.'};
  let current;
  try { current = await load(); }
  catch { return {statusCode:503, headers:noStore, body:'Access management is temporarily unavailable.'}; }
  const kerberos = policy.normalizeLogin(user.kerberos);
  const actualPolicy=current,view=testView.restrict(event,user,current,policy);
  if(view.denied)return {statusCode:403,headers:noStore,body:'This test view is not available to this login.'};
  current=view.current;
  const role=scope==='any' ? Object.keys(policy.SCOPES).map(s=>policy.effectiveRole(current.data,kerberos,s,audience)).reduce((a,b)=>(policy.ROLES[b]||0)>(policy.ROLES[a]||0)?b:a,null) : policy.effectiveRole(current.data,kerberos,scope,audience);
  if (!kerberos || !policy.CAPABILITIES[minimum] || (policy.CAPABILITIES[role]||0)<policy.CAPABILITIES[minimum]) return {statusCode:403, headers:{...noStore,'Content-Type':'text/plain; charset=utf-8'}, body:'Your MIT account is not authorized for this page or operation. Signed-in login: '+(kerberos || '(not supplied in a supported format by MIT)')+'. Ask an MITSOEServices administrator to grant this login access.'};
  let visible;try{visible=features.effectiveFeatures((await loadFeatures()).data,Boolean(policy.effectiveRole(current.data,kerberos,'school','limited')));}catch{return {statusCode:503,headers:noStore,body:'Page visibility could not be verified. Please try again later.'};}
  const feature=features.featureFor(event);if(feature&&visible[feature]===false)return {statusCode:403,headers:noStore,body:'This resource is temporarily unavailable for your access level.'};
  const managedScopes=policy.managedScopes(current.data,kerberos);
  const unitCount=Object.keys(units.ALL_UNITS).filter(s=>policy.effectiveRole(current.data,kerberos,s,'limited')).length;
  const navigation={testView:view.active,rct:Boolean(policy.effectiveRole(current.data,kerberos,'rct')),academic:Object.keys(units.UNITS).some(s=>Boolean(policy.effectiveRole(current.data,kerberos,s,'limited'))),other:Object.keys(units.OTHER_UNITS).some(s=>Boolean(policy.effectiveRole(current.data,kerberos,s,'limited')))};
  Object.assign(navigation,{unitCount,compactUnits:unitCount>0&&unitCount<=3,features:visible});
  return {user, kerberos, role, scope, audience, navigation, features:visible, testView:view.active, actualPolicy, schoolAccess:Boolean(policy.effectiveRole(current.data,kerberos,'school','full')), canWrite:policy.CAPABILITIES[role]>=2, admin:policy.effectiveRole(current.data,kerberos)==='admin',canManage:managedScopes.length>0,managedScopes,policy:current};
}
module.exports = {authorize, noStore};
