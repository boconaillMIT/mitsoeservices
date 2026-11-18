'use strict';
(() => {
  const localOrigin = 'http://127.0.0.1:8767';
  const protocol = 'soe-reports-v1';
  const $ = id => document.getElementById(id);
  let popup = null, nonce = null, connected = false, configs = [], snapshot = null, latestResult = null;
  let handshake = null, timeout = null;
  const pending = new Map();
  const money = value => value === null || value === undefined ? 'Unavailable' :
    new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}).format(Number(value));
  const status = text => { $('status').textContent = text; };
  function send(message) { popup?.postMessage({...message, protocol, nonce}, localOrigin); }
  function clearConnection() {
    popup?.close(); popup = null; nonce = null;
    clearInterval(handshake); clearTimeout(timeout); connected = false;
    $('connect').disabled = false; $('disconnect').disabled = true; $('controls').hidden = true;
    $('report').hidden = true; snapshot = null; latestResult=null; $('publish').disabled=true; configs = []; $('accounts').value = ''; $('name').value = '';
    for (const {reject, timer} of pending.values()) { clearTimeout(timer); reject(Error('Local worker disconnected.')); }
    pending.clear();
  }
  async function accessCheck() {
    const response = await fetch('/.netlify/functions/report-access', {cache:'no-store',credentials:'same-origin'});
    if (!response.ok) throw Error('MIT sign-in or site access has expired. Reload this page and sign in again.');
  }
  async function rpc(payload) {
    await accessCheck();
    if (!connected || !popup || popup.closed) throw Error('Connect the local worker first.');
    const id = crypto.randomUUID();
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(Error('The local operation timed out. Check the worker and VPN before retrying.')); }, 240000);
      pending.set(id,{resolve,reject,timer}); send({type:'request',id,payload});
    });
  }
  function element(tag, text) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; return el; }
  function option(select, value, text) { const el = element('option',text); el.value=value; select.append(el); }
  async function loadOptions() {
    const data = await rpc({action:'options'}); configs = data.configurations;
    $('period').replaceChildren(); for (const p of data.periods) option($('period'),p.value,p.label);
    $('configurations').replaceChildren(); option($('configurations'),'','New selection');
    for (const c of configs) option($('configurations'),c.id,c.name);
  }
  window.addEventListener('message', async event => {
    if (!popup || event.source !== popup || event.origin !== localOrigin) return;
    const data = event.data;
    if (!data || data.protocol !== protocol || data.nonce !== nonce) return;
    if (data.type === 'waiting') status('Choose Connect in the local worker window, then return here.');
    if (data.type === 'connected' && !connected) {
      clearInterval(handshake); clearTimeout(timeout); connected = true;
      $('connect').disabled=true; $('disconnect').disabled=false;
      try { await loadOptions(); $('controls').hidden=false; status('Connected to your computer. Reports and saved selections stay local.'); }
      catch (error) { status(error.message); }
    }
    if (data.type === 'disconnected') { clearConnection(); status('Local worker disconnected.'); }
    if (data.type === 'response' && pending.has(data.id)) {
      const request = pending.get(data.id); pending.delete(data.id); clearTimeout(request.timer);
      data.error ? request.reject(Error(data.error)) : request.resolve(data.result);
    }
  });
  $('connect').addEventListener('click', () => {
    clearConnection();
    nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
    // A top-level local window avoids third-party cookies, CORS, and cross-network fetches.
    popup = window.open(localOrigin + '/hosted-report-bridge', 'soe-worker-' + nonce, 'popup,width=760,height=650');
    if (!popup) { status('Allow popups for this site, then choose Connect again.'); return; }
    $('connect').disabled=true; status('Waiting for the worker. Approve the connection in its window.');
    handshake = setInterval(() => {
      if (popup.closed) { clearConnection(); status('The local window closed. Start the worker and reconnect.'); }
      else send({type:'hello'});
    },500);
    timeout = setTimeout(() => { clearConnection(); status('Connection not established. Start the updated worker, allow the popup, and try again.'); },120000);
  });
  $('disconnect').addEventListener('click', () => { popup?.close(); popup=null; nonce=null; clearConnection(); status('Disconnected.'); });
  window.addEventListener('pagehide', () => { popup?.close(); clearConnection(); });
  setInterval(() => { if (connected && popup?.closed) { clearConnection(); status('The local worker window closed. Reconnect to continue.'); } },1500);
  const initialView=new URLSearchParams(location.search).get('view');
  if (['deans','all'].includes(initialView)) { $('view').value = initialView; $('custom').hidden = true; }
  $('view').addEventListener('change', () => { $('custom').hidden = $('view').value !== 'custom'; });
  $('configurations').addEventListener('change', () => {
    const config = configs.find(c=>c.id === $('configurations').value);
    $('accounts').value = config ? config.accounts.join('\n') : ''; $('name').value = config?.name || '';
  });
  async function accountText() {
    const file = $('file').files[0];
    if (file && file.size > 256 * 1024) throw Error('Choose an account list smaller than 256 KB.');
    return file ? file.text() : $('accounts').value;
  }
  async function operation(button, work) {
    button.disabled=true;
    try { await work(); } catch (error) { status(error.message); }
    finally { button.disabled=false; }
  }
  $('save').addEventListener('click', () => operation($('save'), async () => {
    const accounts = await accountText(); const name = $('name').value;
    await rpc({action:'save',accounts,name}); await loadOptions(); status('Account selection saved on this computer.');
  }));
  $('run').addEventListener('click', () => operation($('run'), async () => {
    $('report').hidden=true; status('Reading Warehouse balances and Quickbase allocations on your computer…');
    const data = await rpc({action:'run',accounts:$('view').value === 'custom' ? await accountText() : '',
      view:$('view').value,period:$('period').value,include_pending:$('pending').checked});
    snapshot=data.snapshot; latestResult=data.result; $('publish').disabled=data.result.view!=='all'; render(data.result); status('Report complete. Results are displayed in this browser and stored on your computer.');
  }));
  function render(result) {
    $('report-title').textContent = result.view === 'all' ? 'All SoE-controlled accounts' : result.view === 'deans' ? 'Dean’s discretionary accounts' : 'Selected accounts';
    $('report-meta').textContent = `${result.rows.length} accounts · Balance period ${result.period} · Retrieved ${result.retrieved} · ${result.include_pending ? 'Active + Pending' : 'Active'} outgoing commitments`;
    if (result.proration) $('report-meta').textContent += ` · Remaining after ${result.proration.as_of}: ${result.proration.remaining_days}/${result.proration.fiscal_year_days} days (${result.proration.remaining_percent}% of annual estimate)`;
    $('rows').replaceChildren();
    for (const row of result.rows) {
      const tr=element('tr'); tr.append(element('td',row.key));
      const name=element('td',row.name); if (row.category) name.append(element('small',row.category)); tr.append(name);
      for (const value of [row.balance,row.projected,row.estimate,row.after]) tr.append(element('td',money(value)));
      const review=element('td');
      if (row.issues.length) review.append(element('p',row.issues.join('; ')));
      if (row.details.length) {
        const details=element('details'); details.append(element('summary',`${row.details.length} payment allocations`));
        details.append(element('p',`FY27 actual: ${money(row.actual)} (not deducted again)`));
        const list=element('ul');
        for (const d of row.details) {
          const item=element('li'); const link=element('a',`Payment ${d.payment}`);
          if (/^\d+$/.test(String(d.payment))) link.href='https://mit.quickbase.com/db/bs2mgyyvx?a=dr&rid='+d.payment;
          link.target='_blank'; link.rel='noopener'; item.append(link,document.createTextNode(` · ${d.commitment} · ${d.status} · ${money(d.amount)}`)); list.append(item);
        }
        details.append(list); review.append(details);
      } else if (!row.issues.length) review.append(element('small','No allocated FY27 payments'));
      tr.append(review); $('rows').append(tr);
    }
    const complete = result.total_after !== null;
    const footer=element('tr'); const label=element('th',complete ? `TOTAL · ${result.rows.length} accounts` : `SUBTOTAL · ${result.available_count} available accounts`);
    label.colSpan=2; footer.append(label);
    for (const value of complete ? [result.total_balance,result.total_projected,result.total_estimate,result.total_after] : [result.available_balance,result.available_projected,result.available_estimate,result.available_after]) footer.append(element('td',money(value)));
    footer.append(element('td',complete ? '' : `Incomplete: excludes ${result.rows.length-result.available_count} accounts with unavailable amounts.`));
    $('totals').replaceChildren(footer); $('flags').replaceChildren();
    $('flags-title').textContent=`${result.issues.length} source allocation flags — review before relying on projections`;
    for (const issue of result.issues) $('flags').append(element('li',issue));
    $('report').hidden=false;
  }
  $('publish').addEventListener('click',()=>operation($('publish'),async()=>{
    if(latestResult?.view!=='all')throw Error('Run All SoE-controlled accounts before publishing.');
    await accessCheck();
    const response=await fetch('/.netlify/functions/published-report',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(latestResult)});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Publishing failed.');
    $('publish-status').textContent='Published '+result.accounts+' accounts at '+new Date(result.published_at).toLocaleString()+'. Colleagues can now view this report without a worker.';
  }));
  $('export').addEventListener('click', () => operation($('export'), async () => {
    const {csv} = await rpc({action:'export',snapshot});
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const link=element('a'); link.href=url; link.download='FY27-account-outlook.csv'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }));
})();
