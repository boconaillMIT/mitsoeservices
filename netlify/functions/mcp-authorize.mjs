import sso from '../../src/mit-sso.cjs';
import policy from '../../src/policy.cjs';
import {eventFrom} from '../../src/http.mjs';
import {createAuthorize,blobMarkUsed} from '../../src/mcp-auth.mjs';
const auth=sso.createAuth();
const handle=createAuthorize({readSession:request=>auth.readSession(eventFrom(request)),markUsed:blobMarkUsed});
export default(request,context)=>policy.withPolicyContext(context,()=>handle(request));
