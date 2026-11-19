import {handler} from '../../src/rct-review.mjs';
import policy from '../../src/policy.cjs';
import {eventFrom,responseFrom} from '../../src/http.mjs';
export default(request,context)=>policy.withPolicyContext(context,async()=>{
 if(request.method==='POST'&&Number(request.headers.get('content-length'))>70000)return new Response('Review too large.',{status:413,headers:{'Cache-Control':'no-store'}});
 const event=eventFrom(request);if(request.method==='POST'){const reader=request.body?.getReader();let size=0;const chunks=[];if(reader)for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>70000){await reader.cancel();return new Response('Review too large.',{status:413,headers:{'Cache-Control':'no-store'}});}chunks.push(value);}event.body=Buffer.concat(chunks).toString('utf8');}
 return responseFrom(await handler(event));
});
