import policy from './policy.cjs';
import {PRIVATE_OWNER,PRIVATE_OWNERS} from '../public/aeroastro-private-schema.mjs';
export const PRIVATE_NOTES_OWNER=PRIVATE_OWNER;
export function privateNotesOwner(auth){const owner=policy.normalizeLogin(auth?.user?.kerberos);return auth?.scope==='finance:aeroastro'&&owner===auth.kerberos&&PRIVATE_OWNERS.includes(owner)?owner:null;}
// Administrative access never selects another person's notebook.
export function privateNotesAccess(auth){const denied={canRead:false,canWrite:false},owner=privateNotesOwner(auth);if(!owner)return denied;const role=policy.effectiveRole(auth.policy?.data,owner,'finance:aeroastro','full');if(!role||!policy.CAPABILITIES[role])return denied;return {canRead:true,canWrite:policy.CAPABILITIES[role]>=2&&auth.canWrite===true};}
