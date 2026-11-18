import sso from '../../src/mit-sso.cjs';
const auth=sso.createAuth();
// Preserve distinct Set-Cookie headers through Netlify's native Lambda response.
export const handler=async event=>auth.handle('login',event);
