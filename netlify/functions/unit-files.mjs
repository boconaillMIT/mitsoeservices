import {handler,MAX_FILE_BYTES} from '../../src/unit-files.mjs';
import policy from '../../src/policy.cjs';
import {eventFrom,responseFrom} from '../../src/http.mjs';
export default(request,context)=>policy.withPolicyContext(context,async()=>{
 if(request.method==='POST'&&Number(request.headers.get('content-length'))>Math.ceil(MAX_FILE_BYTES/3)*4+1000)return new Response('Files must be 4 MB or smaller.',{status:413,headers:{'Cache-Control':'no-store'}});
 const event=eventFrom(request);if(request.method==='POST')event.body=await request.text();
 return responseFrom(await handler(event));
});
