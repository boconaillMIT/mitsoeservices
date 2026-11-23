const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(v);
export function validSubmission(s){
 return Boolean(s&&s.schema===1&&/^[a-z][a-z0-9-]{0,59}$/.test(s.unit||'')&&Number.isInteger(s.year)&&s.year>=2020&&s.year<=2100&&/^\d{4}-\d{2}-\d{2}$/.test(s.date||'')&&typeof s.document==='string'&&s.document.length<=200&&/^[a-f0-9]{64}$/.test(s.sha||'')&&typeof s.summary==='string'&&s.summary.length<=3000&&Array.isArray(s.facts)&&s.facts.length<=20&&s.facts.every(f=>typeof f.label==='string'&&f.label.length<=120&&Number.isFinite(f.amount))&&Array.isArray(s.funds)&&s.funds.length<=10&&s.funds.every(f=>typeof f.label==='string'&&f.label.length<=160&&Array.isArray(f.years)&&f.years.length<=10&&f.years.every(y=>Number.isInteger(y.year)&&typeof y.projected==='boolean'&&['income','expense','balance'].every(k=>Number.isFinite(y[k]))))&&typeof s.lineNote==='string'&&s.lineNote.length<=2000);
}
export function latestSubmission(rows,unit,year){
 return rows.flatMap(r=>r.source?.submissions||[]).filter(s=>validSubmission(s)&&s.unit===unit&&(year===undefined||s.year===year)).sort((a,b)=>b.date.localeCompare(a.date))[0]||null;
}
export function submissionHtml(s,{compact=false}={}){
 if(!validSubmission(s))return '';
 const source=`${esc(s.document)} · revised ${esc(s.date)}`;
 const funds=compact?s.funds.map(f=>({label:f.label,years:f.years.filter(y=>y.year===s.year)})):s.funds.map(f=>({...f,years:f.years.filter(y=>y.year>=s.year-2)}));
 return `<section class="submission-outlook" aria-label="Latest budget submission"><h${compact?'4':'2'}>FY${String(s.year).slice(-2)} revised submission outlook</h${compact?'4':'2'}><p class="small">${source}</p><p>${esc(s.summary)}</p><p class="small">Submission forecasts and fund categories are separate from the account-level wallet. They are not added to wallet totals or treated as uncommitted resources.</p>${compact?'':`<dl class="submission-facts">${s.facts.map(f=>`<div><dt>${esc(f.label)}</dt><dd>${money(f.amount)}</dd></div>`).join('')}</dl>`}<h${compact?'5':'3'}>Fund balances reported in the memo</h${compact?'5':'3'}><div class="wallet-table"><table class="submission-table"><thead><tr><th>Fund category</th><th>FY</th>${compact?'':'<th>Income</th><th>Expenditure</th>'}<th>Closing balance</th><th>Basis</th></tr></thead><tbody>${funds.flatMap(f=>f.years.map(y=>`<tr><td>${esc(f.label)}</td><td>${y.year}</td>${compact?'':`<td>${money(y.income)}</td><td>${money(y.expense)}</td>`}<td>${money(y.balance)}</td><td>${y.projected?'Projected':'Reported historical'}</td></tr>`)).join('')}</tbody></table></div><p class="small">Chart figures are rounded to the nearest $1,000. Other Pool A excludes chairs, fellowships and unrestricted funds. Historical rows follow this memo’s revised classification.</p></section>`;
}
export function submissionLineHtml(source){
 const s=(source?.submissions||[]).filter(validSubmission).sort((a,b)=>b.date.localeCompare(a.date))[0];
 return s?`<details class="budget-source-note"><summary>Revised submission · ${esc(s.date)}</summary><p><strong>${esc(s.document)}</strong></p><p>${esc(s.lineNote)}</p></details>`:'';
}
