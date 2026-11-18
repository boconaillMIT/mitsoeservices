import {dataHandler} from '../../src/budget-hq.mjs';
import policy from '../../src/policy.cjs';
import {eventFrom,responseFrom} from '../../src/http.mjs';
export default(request,context)=>policy.withPolicyContext(context,async()=>responseFrom(await dataHandler(eventFrom(request))));
