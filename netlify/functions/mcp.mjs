import {createMcpHandler} from '../../src/mcp-server.mjs';
import policy from '../../src/policy.cjs';
const handle=createMcpHandler();
export default(request,context)=>policy.withPolicyContext(context,()=>handle(request));
