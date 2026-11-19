const sso=require('../../src/mit-sso.cjs');
const auth=sso.createAuth();
// Match Netlify's CommonJS launcher for native Lambda handlers.
// Preserve distinct Set-Cookie headers through Netlify's native Lambda response.
exports.handler=async event=>auth.handle('session',event);
