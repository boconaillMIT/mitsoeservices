import {handler} from '../../src/donation-requests.mjs';
import policy from '../../src/policy.cjs';
import {eventFrom,responseFrom} from '../../src/http.mjs';
export default (request,context)=>policy.withPolicyContext(context,async()=>{
 const limit=4300000,event=eventFrom(request);
 if(request.method==='POST'){
  if(Number(request.headers.get('content-length'))>limit)return new Response('Request too large.',{status:413,headers:{'Cache-Control':'no-store'}});
  const reader=request.body?.getReader(),chunks=[];let size=0;if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();return new Response('Request too large.',{status:413,headers:{'Cache-Control':'no-store'}});}chunks.push(value);}event.body=Buffer.concat(chunks).toString('utf8');
 }
 return responseFrom(await handler(event));
});
