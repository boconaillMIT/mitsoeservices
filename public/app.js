const button = document.querySelector('#check');
const result = document.querySelector('#result');
button?.addEventListener('click', async () => {
  button.disabled = true;
  result.className = '';
  result.textContent = 'Checking connections from Netlify…';
  try {
    const response = await fetch('/.netlify/functions/connectivity');
    if (!response.ok) throw new Error('Connectivity function is not available yet.');
    const data = await response.json();
    result.textContent = `MIT warehouse: ${data.warehouse.reachable ? 'Reachable' : data.warehouse.reason}\nQuickbase: ${data.quickbase.reachable ? 'Reachable' : data.quickbase.reason}\nNo credentials sent. Database sign-in remains untested.`;
    if (!data.warehouse.reachable) result.className = 'error';
  } catch (error) {
    result.className = 'error';
    result.textContent = error.message;
  } finally { button.disabled = false; }
});

document.querySelector('#logout')?.addEventListener('click', async () => {
  const response = await fetch('/.netlify/functions/auth-logout', {method:'POST', credentials:'same-origin'});
  if (response.ok) window.location.assign('/');
});
