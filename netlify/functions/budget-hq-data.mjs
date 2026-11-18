import {dataHandler} from '../../src/budget-hq.mjs';
import policy from '../../src/policy.cjs';
import {eventFrom,responseFrom} from '../../src/http.mjs';
export default(request,context)=>policy.withPolicyContext(context,async()=>{
 if(request.method!=='GET'&&Number(request.headers.get('content-length'))>40000)return new Response('Request too large.',{status:413,headers:{'Cache-Control':'no-store'}});
 const event=eventFrom(request);if(request.method!=='GET')event.body=await request.text();
 return responseFrom(await dataHandler(event));
});
