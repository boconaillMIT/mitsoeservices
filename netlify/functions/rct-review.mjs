import {handler} from '../../src/rct-review.mjs';
import policy from '../../src/policy.cjs';
import {eventFrom,responseFrom} from '../../src/http.mjs';
export default(request,context)=>policy.withPolicyContext(context,async()=>{
 const upload=new URL(request.url).pathname.endsWith('/versions')||new URL(request.url).searchParams.get('action')==='versions',limit=upload?4200000:70000;
 if(request.method==='POST'&&Number(request.headers.get('content-length'))>limit)return new Response('Review too large.',{status:413,headers:{'Cache-Control':'no-store'}});
 const event=eventFrom(request);if(request.method==='POST'){const reader=request.body?.getReader();let size=0;const chunks=[];if(reader)for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();return new Response('Review too large.',{status:413,headers:{'Cache-Control':'no-store'}});}chunks.push(value);}event.body=Buffer.concat(chunks).toString('utf8');}
 return responseFrom(await handler(event));
});
