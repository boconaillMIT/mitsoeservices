import {handler} from '../../src/unit-hub.mjs';
import policy from '../../src/policy.cjs';
import {eventFrom,responseFrom} from '../../src/http.mjs';
export default (request,context)=>policy.withPolicyContext(context,async()=>responseFrom(await handler(eventFrom(request))));
