const policy=require('./policy.cjs');
const DEFINITIONS=Object.freeze({wallets:'Financial resources / wallets',nimbus:'Nimbus Search','account-inventory':'Account-list review (pilot)',allocations:'Annual unit allocations',commitments:'Unit commitments & payments','account-review':'Account review & notes','aeroastro-finance':'AeroAstro finance workspace (separate permission)'});
function defaults(){return {schema:1,features:Object.fromEntries(Object.keys(DEFINITIONS).map(k=>[k,{school:true,units:true}])),audit:[]};}
function validate(value){
 if(value?.schema!==1||!value.features||typeof value.features!=='object'||Object.keys(value.features).some(k=>!Object.hasOwn(DEFINITIONS,k))||Object.values(value.features).some(v=>!v||typeof v.school!=='boolean'||typeof v.units!=='boolean')||!Array.isArray(value.audit))throw Error('Invalid feature policy.');
 return {...value,features:{...defaults().features,...value.features}};
}
async function featureStore(){const {getStore}=await import('@netlify/blobs');return getStore({name:'mitsoeservices-visibility-'+policy.deploymentName(),consistency:'strong'});}
async function loadFlags(store){store||=await featureStore();const entry=await store.getWithMetadata('feature-policy',{type:'json'});return {data:entry?validate(entry.data):defaults(),etag:entry?.etag||null};}
function effectiveFeatures(data,school){return Object.fromEntries(Object.keys(DEFINITIONS).map(k=>[k,(data?.features?.[k]||defaults().features[k])[school?'school':'units']]));}
function featureFor(event){
 const p=event.path||'',q=event.queryStringParameters||{},page=q.page||p;
 if(/\/aeroastro-finance$/.test(p)||/^\/units\/aeroastro\/finance(?:\/|$)/.test(p))return 'aeroastro-finance';
 if(/(?:^|\/)(?:account-review|account-review-page)$/.test(p)||/\/account-review(?:\/\d+)?\/?$/.test(p))return 'account-review';
 if(/(?:^|\/)(?:unit-commitments|unit-commitments-page)$/.test(p)||/\/commitments(?:\/closed)?\/?$/.test(p))return 'commitments';
 if(/(?:^|\/)(?:unit-data|wallet-categories)$/.test(p)||/\/wallet\/?$/.test(p)||/\/wallets\//.test(p)||p==='/soe-wallet'||/\/unit-page$/.test(p)&&(q.section==='wallet'||q.unit==='school'&&!q.section))return 'wallets';
 if(/(?:^|\/)(?:nimbus-data|nimbus-page)$/.test(p)||/\/nimbus\/?$/.test(page)||/\/worker-pilot(?:-page)?$/.test(p)&&q.report==='nimbus')return 'nimbus';
 if(/(?:^|\/)(?:account-inventory|account-inventory-page)$/.test(p)||/\/account-list\/?$/.test(p)||/\/worker-pilot(?:-page)?$/.test(p)&&q.report==='account-inventory')return 'account-inventory';
 if(/(?:^|\/)(?:unit-allocations|unit-allocations-page)$/.test(p)||/\/allocations\/?$/.test(p))return 'allocations';
 return null;
}
module.exports={DEFINITIONS,defaults,validate,featureStore,loadFlags,effectiveFeatures,featureFor};
