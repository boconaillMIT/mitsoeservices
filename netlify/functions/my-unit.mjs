import {handler} from '../../src/my-unit.mjs';
import {eventFrom,responseFrom} from '../../src/http.mjs';
import policy from '../../src/policy.cjs';
export default(request,context)=>policy.withPolicyContext(context,async()=>responseFrom(await handler(eventFrom(request))));
