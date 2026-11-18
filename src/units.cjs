const UNITS=Object.freeze({
 'soe-fake':{label:'SOE Fake',name:'SOE Fake — fictional test unit',source:'SOE Fake — fictional test unit',testOnly:true},
 aeroastro:{label:'AeroAstro',name:'Aeronautics & Astronautics',source:'Aeronautics & Astronautics'},
 be:{label:'BE',name:'Biological Engineering',source:'Department of Biological Engineering'},
 cheme:{label:'ChemE',name:'Chemical Engineering',source:'Chemical Engineering'},
 cee:{label:'CEE',name:'Civil & Environmental Engineering',source:'Civil & Environmental Engineering'},
 eecs:{label:'EECS',name:'Electrical Engineering & Computer Science',source:'Electrical Engineering & Computer Sci'},
 imes:{label:'IMES',name:'Institute for Medical Engineering & Science',source:'Inst for Medical Eng & Sci'},
 idss:{label:'IDSS',name:'Institute for Data, Systems and Society',source:'Institute for Data, Systems and Society'},
 dmse:{label:'DMSE',name:'Materials Science & Engineering',source:'Materials Science & Engineering'},
 meche:{label:'MechE',name:'Mechanical Engineering',source:'Mechanical Engineering'},
 nse:{label:'NSE',name:'Nuclear Science & Engineering',source:'Nuclear Science & Engineering'}
});
const OTHER_UNITS=Object.freeze({"aso": {"label": "Administrative Services Organization", "name": "Administrative Services Organization", "source": "Administrative Services Organization"}, "ai-lab": {"label": "Artificial Intelligence Laboratory", "name": "Artificial Intelligence Laboratory", "source": "Artificial Intelligence Laboratory"}, "bpec": {"label": "Biotechnology Process Engineering Center", "name": "Biotechnology Process Engineering Center", "source": "Biotechnology Process Engineering Center"}, "cbi": {"label": "Center for Biomedical Innovation", "name": "Center for Biomedical Innovation", "source": "Center for Biomedical Innovation"}, "ctl": {"label": "Center for Transportation & Logistics", "name": "Center for Transportation & Logistics", "source": "Center for Transportation & Logistics"}, "cipd": {"label": "Ctr for Innovation in Prod Dev", "name": "Ctr for Innovation in Prod Dev", "source": "Ctr for Innovation in Prod Dev"}, "dept-heads": {"label": "Dept Heads/School of Engineering", "name": "Dept Heads/School of Engineering", "source": "Dept Heads/School of Engineering"}, "deshpande": {"label": "Deshpande Center", "name": "Deshpande Center", "source": "Deshpande Center"}, "gel": {"label": "Gordon Engineering Leadership Program", "name": "Gordon Engineering Leadership Program", "source": "Gordon Engineering Leadership Program"}, "ipc": {"label": "Industrial Performance Center", "name": "Industrial Performance Center", "source": "Industrial Performance Center"}, "lcs": {"label": "Lab for Computer Science", "name": "Lab for Computer Science", "source": "Lab for Computer Science"}, "lgo": {"label": "Leaders for Global Operations Program", "name": "Leaders for Global Operations Program", "source": "Leaders for Global Operations Program"}, "lemelson": {"label": "Lemelson-MIT Program", "name": "Lemelson-MIT Program", "source": "Lemelson-MIT Program"}, "professional-education": {"label": "MIT Professional Education", "name": "MIT Professional Education", "source": "MIT Professional Education"}, "mit-portugal": {"label": "MIT-Portugal Program", "name": "MIT-Portugal Program", "source": "MIT-Portugal Program"}, "innovation": {"label": "Office of Innovation", "name": "Office of Innovation", "source": "Office of Innovation"}, "soe-special": {"label": "SOE Special Programs", "name": "SOE Special Programs", "source": "SOE Special Programs"}, "sma": {"label": "Singapore-MIT Alliance", "name": "Singapore-MIT Alliance", "source": "Singapore-MIT Alliance"}, "ssrc": {"label": "Sociotechnical Systems Research Center", "name": "Sociotechnical Systems Research Center", "source": "Sociotechnical Systems Research Center"}, "scm": {"label": "Supply Chain Management Program", "name": "Supply Chain Management Program", "source": "Supply Chain Management Program"}, "sdm": {"label": "System Design & Management", "name": "System Design & Management", "source": "System Design & Management"}, "tpp": {"label": "Technology And Policy Program", "name": "Technology And Policy Program", "source": "Technology And Policy Program"}});
const MANAGED_WALLETS=Object.freeze({"archaeology": {"label": "Archaeology", "name": "Archaeology", "source": "Archaeology", "parent": "dmse", "slug": "archaeology"}, "ppst": {"label": "PPSM", "name": "PPSM (Program in Polymer Science & Technology)", "source": "Program in Polymer Science & Technology", "parent": "dmse", "slug": "ppsm"}});
const ALL_UNITS=Object.freeze({...UNITS,...OTHER_UNITS});
const WALLETS=Object.freeze({...ALL_UNITS,...MANAGED_WALLETS,school:{label:'SoE',name:'Dean/School of Engineering',source:'Dean/School of Engineering'}});
function permissionScope(scope){return MANAGED_WALLETS[scope]?.parent||scope;}
function walletsForUnit(scope){return [scope,...Object.keys(MANAGED_WALLETS).filter(key=>permissionScope(key)===scope)];}
function unitPath(scope,section='full'){
 if(MANAGED_WALLETS[scope])return section==='wallet'?'/units/'+permissionScope(scope)+'/wallets/'+MANAGED_WALLETS[scope].slug:unitPath(permissionScope(scope),section);
 if(scope==='school')return '/soe-wallet';
 return (Object.hasOwn(UNITS,scope)?'/units/':'/other-units/')+scope+'/'+section;
}
function unitRoute(event){
 if(event.path==='/soe-wallet')return {scope:'school',section:'wallet'};
 const managed=/^\/units\/dmse\/wallets\/(archaeology|ppsm)\/?$/.exec(event.path||'');
 if(managed)return {scope:managed[1]==='ppsm'?'ppst':'archaeology',section:'wallet'};
 const direct=/^\/(units|other-units)\//.test(event.path||'');
 const match=direct?/^\/(units|other-units)\/([a-z][a-z-]*)(?:\/(full|limited|wallet))?\/?$/.exec(event.path):null;
 const scope=direct?match?.[2]:event.queryStringParameters?.unit;
 const section=direct?(match?.[3]||'full'):(event.queryStringParameters?.section||(scope==='school'?'wallet':'full'));
 if(direct&&(!match||!Object.hasOwn(match[1]==='units'?UNITS:{...OTHER_UNITS,...MANAGED_WALLETS},scope||'')))return null;
 return Object.hasOwn(WALLETS,scope||'')&&['full','limited','wallet'].includes(section)&&(scope!=='school'||section==='wallet')?{scope,section}:null;
}
// User requested unlocking all wallets on 2026-10-28. Per-unit Full Access
// authorization still applies to pages and data, including DMSE managed wallets.
function walletBlocked(scope){return false;}
function unitScope(event){return unitRoute(event)?.scope||null;}
module.exports={MANAGED_WALLETS,permissionScope,walletsForUnit,UNITS,OTHER_UNITS,ALL_UNITS,WALLETS,unitPath,unitScope,unitRoute,walletBlocked};
