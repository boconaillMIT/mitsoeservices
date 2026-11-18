import access from '../../src/access.cjs';
import {eventFrom,responseFrom} from '../../src/http.mjs';
import policy from '../../src/policy.cjs';
export default (request,context) => policy.withPolicyContext(context, async () => {
  if (request.method !== 'GET') return new Response('GET required', {status:405,headers:access.noStore});
  const result = await access.authorize(eventFrom(request),{scope:'school',minimum:'admin'});
  return result.user ? Response.json({authorized:true}, {headers:access.noStore}) : responseFrom(result);
});
