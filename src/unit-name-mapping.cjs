const units=require('./units.cjs');
// Explicit identities only. Formatting normalization is not fuzzy name matching.
const approved={aeroastro:['AA','AeroAstro','Aero Astro','Aero/Astro'],be:['BE'],cheme:['ChemE'],cee:['CEE'],eecs:['EECS'],imes:['IMES'],idss:['IDSS'],dmse:['DMSE','DSME','PPSM','PPST','Archaeology','Program in Polymer Science & Technology'],meche:['MechE','ME'],nse:['NSE'],school:['SoE','School of Engineering','Dean/School of Engineering'],ctl:['CTL'],aso:['ASO'],ssrc:['SSRC'],gel:['GEL'],lgo:['LGO'],lemelson:['Lemelson'],sdm:['SDM'],scm:['SCM'],tpp:['TPP'],deshpande:['Deshpande Center'],innovation:['iHQ']};
const key=value=>String(value??'').normalize('NFKC').trim().toLowerCase().replace(/&/g,'and').replace(/[\s.,_()/\-]/g,'');
const aliases=Object.fromEntries(Object.entries({...units.ALL_UNITS,school:units.WALLETS.school}).filter(([id])=>id!=='soe-fake').map(([id,u])=>[id,[...new Set([u.name,u.source,u.label,...(approved[id]||[]),...(units.UNITS[id]?['Department of '+u.name,'Dept. of '+u.name]:[])])]]));
const lookup=new Map();for(const [scope,names]of Object.entries(aliases))for(const name of names){const normalized=key(name);if(lookup.has(normalized)&&lookup.get(normalized)!==scope)throw Error('Conflicting canonical unit names.');lookup.set(normalized,scope);}
function scopeFor(value){return lookup.get(key(value))||null;}
module.exports={aliases,scopeFor,key};
