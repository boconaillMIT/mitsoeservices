import policy from './policy.cjs';
export const PRIVATE_NOTES_OWNER='tara1013';
// A School administrator's ordinary override must never expose another
// person's private notes. Require the real signed-in identity, not a view-as
// label or an owner supplied by the browser, and a current finance grant.
export function privateNotesAccess(auth){
 const denied={canRead:false,canWrite:false};
 if(!auth?.user||auth.scope!=='finance:aeroastro'||auth.kerberos!==PRIVATE_NOTES_OWNER||policy.normalizeLogin(auth.user.kerberos)!==PRIVATE_NOTES_OWNER)return denied;
 const role=policy.effectiveRole(auth.policy?.data,PRIVATE_NOTES_OWNER,'finance:aeroastro','full');
 if(!role||!policy.CAPABILITIES[role])return denied;
 return {canRead:true,canWrite:policy.CAPABILITIES[role]>=2&&auth.canWrite===true};
}
