import {handler as serve} from '../../src/visibility.mjs';import policy from '../../src/policy.cjs';import {eventFrom,responseFrom} from '../../src/http.mjs';
export default (request,context)=>policy.withPolicyContext(context,async()=>{const event=eventFrom(request);if(request.method==='POST')event.body=await request.text();return responseFrom(await serve(event));});
