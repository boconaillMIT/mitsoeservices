import policy from '../../src/policy.cjs';
import {createToken,blobMarkUsed} from '../../src/mcp-auth.mjs';
const handle=createToken({markUsed:blobMarkUsed});
export default(request,context)=>policy.withPolicyContext(context,()=>handle(request));
