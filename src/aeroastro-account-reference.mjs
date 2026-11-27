const account=v=>typeof v==='string'&&/^\d{7}$/.test(v),text=(v,max=12000)=>typeof v==='string'&&v.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v);
export function validateAccountReference(v){
 if(v?.schema!==1||v.unit!=='aeroastro'||v.kind!=='account-reference'||!Number.isFinite(Date.parse(v.importedAt))||!/^[-a-z0-9_]{1,64}$/.test(v.importedBy||''))throw Error('Invalid reference source');
 if(!Array.isArray(v.sources)||v.sources.length!==3||v.sources.some(s=>!['handoff','dhc','dashboard'].includes(s.id)||!text(s.name,300)||!/^[a-f0-9]{64}$/.test(s.sha256)))throw Error('Invalid reference provenance');
 if(!text(v.handoffLabel,600)||v.dashboardSheet!=='Sum_DHC')throw Error('Invalid source label');
 const uniqueAccounts=rows=>Array.isArray(rows)&&rows.length<=5000&&rows.every(account)&&new Set(rows).size===rows.length;
 if(!uniqueAccounts(v.dhcAccounts)||!Array.isArray(v.groups)||v.groups.length>100||new Set(v.groups.map(g=>g.id)).size!==v.groups.length||v.groups.some(g=>!/^group-\d+$/.test(g.id)||!text(g.label,300)||!uniqueAccounts(g.accounts)))throw Error('Invalid report membership');
 if(!Array.isArray(v.accounts)||v.accounts.length>5000||new Set(v.accounts.map(a=>a.account)).size!==v.accounts.length)throw Error('Invalid account background');
 for(const a of v.accounts){if(!account(a.account)||!Array.isArray(a.entries)||a.entries.length>100)throw Error('Invalid reference account');for(const e of a.entries)if(!text(e.section,300)||!text(e.location,400)||!text(e.text)||!Array.isArray(e.fields)||e.fields.length>30||e.fields.some(p=>!Array.isArray(p)||p.length!==2||!text(p[0],300)||!text(p[1],2000)))throw Error('Invalid reference entry');}
 if(!Array.isArray(v.general)||v.general.length>100||v.general.some(g=>!text(g.text)||!text(g.location,400)))throw Error('Invalid guidance');return v;
}
export function referenceForInventory(reference,rows){
 if(!reference)return null;validateAccountReference(reference);const allowed=new Set(rows.map(r=>r.account));
 // Source documents do not confer account access; financial ownership comes from the verified inventory.
 return {...reference,accounts:reference.accounts.filter(a=>allowed.has(a.account))};
}
