import {createAdminHandler} from '../../src/admin-api.mjs';
import policy from '../../src/policy.cjs';
const handler=createAdminHandler();
export default (request,context)=>policy.withPolicyContext(context,()=>handler(request));
