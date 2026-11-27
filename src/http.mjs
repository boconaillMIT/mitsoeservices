import security from './security-headers.cjs';
export function eventFrom(request) {
  const url = new URL(request.url);
  return {httpMethod:request.method, path:url.pathname, headers:Object.fromEntries(request.headers),
    queryStringParameters:Object.fromEntries(url.searchParams)};
}
export function responseFrom(result) {
  const headers = new Headers(result.headers || {});
  for(const [name,value]of Object.entries(security.SECURITY_HEADERS))if(!headers.has(name))headers.set(name,value);
  for (const [key,values] of Object.entries(result.multiValueHeaders || {}))
    for(const value of values) headers.append(key,value);
  return new Response(result.body || '', {status:result.statusCode,headers});
}
