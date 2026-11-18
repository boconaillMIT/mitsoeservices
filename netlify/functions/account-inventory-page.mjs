import {handler as serve} from '../../src/account-inventory-page.mjs';
import policy from '../../src/policy.cjs';
import {eventFrom,responseFrom} from '../../src/http.mjs';
export default (request,context)=>policy.withPolicyContext(context,async()=>responseFrom(await serve(eventFrom(request))));
