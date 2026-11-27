export const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function backgroundHtml(reference,account){
 const a=reference?.accounts.find(a=>a.account===account);if(!a)return '';
 return `<details class="account-background"><summary>Account background (${a.entries.length})</summary><p class="small">Source: AeroAstro fund accounts handover · ${escapeHtml(reference.handoffLabel)}</p>${a.entries.map(e=>`<article><h4>${escapeHtml(e.section)}</h4>${e.text?`<p>${escapeHtml(e.text)}</p>`:''}${e.fields.length?`<dl>${e.fields.map(([k,v])=>`<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl>`:''}<small>${escapeHtml(e.location)}</small></article>`).join('')}</details>`;
}
