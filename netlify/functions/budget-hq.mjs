import {pageHandler} from '../../src/budget-hq-pages.mjs';
import policy from '../../src/policy.cjs';
import {eventFrom,responseFrom} from '../../src/http.mjs';
export default(request,context)=>policy.withPolicyContext(context,async()=>responseFrom(await pageHandler(eventFrom(request))));
