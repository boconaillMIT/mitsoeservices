/** Deploy this module and the server adapter on each project's own origin. */
export function createMITSSO({ basePath = '/.netlify/functions/' } = {}) {
  const base = new URL(basePath.endsWith('/') ? basePath : basePath + '/', window.location.origin);
  if (base.origin !== window.location.origin) throw new Error('MIT SSO endpoints must be on this website origin');
  const endpoint = action => new URL(`auth-${action}`, base).href;
  return {
    login({ returnTo = window.location.pathname + window.location.search + window.location.hash } = {}) {
      const url = new URL(endpoint('login'));
      url.searchParams.set('returnTo', returnTo);
      window.location.assign(url.href);
    },
    async getUser() {
      const response = await fetch(endpoint('session'), { credentials: 'same-origin', cache: 'no-store' });
      if (response.status === 401) return null;
      if (!response.ok) throw new Error('Unable to check MIT sign-in');
      return (await response.json()).user;
    },
    async requireUser() {
      const user = await this.getUser();
      if (!user) this.login();
      return user;
    },
    async logout() {
      const response = await fetch(endpoint('logout'), { method: 'POST', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Unable to sign out');
    }
  };
}
