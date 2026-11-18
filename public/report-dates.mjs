export function displayDate(value){
 if(value===null||value===undefined||String(value).trim()===''||!Number.isFinite(Date.parse(value)))return 'not recorded';
 const dateOnly=/^\d{4}-\d{2}-\d{2}$/.test(String(value));
 return new Intl.DateTimeFormat('en-US',{dateStyle:'medium',...(dateOnly?{}:{timeStyle:'short'}),timeZone:dateOnly?'UTC':'America/New_York'}).format(new Date(value))+(dateOnly?'':' ET');
}
export function balancePeriod(period){
 const match=/^(\d{4})(\d{2})$/.exec(String(period||''));if(!match)return 'not recorded';
 const year=Number(match[1]),month=Number(match[2]);if(month<1||month>16)return 'not recorded';
 if(month>12)return `FY${String(year).slice(-2)} close / adjustment period ${match[2]} (${period})`;
 return new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(year-(month<=6?1:0),(month+5)%12,1)))+` (${period})`;
}
export function walletDateSummary(data){
 const s=data.statement||{},year=Number(s.balance_year),asOf=Number.isInteger(year)&&year>=2000&&year<=2100?`June 30, ${year} (FY${String(year).slice(-2)} close)`:'not recorded';
 const raw=String(s.updated||'').replace(/^Updated\s+/i,'').trim(),source=/^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/i.test(raw)?raw:displayDate(raw);
 return `Balances as of: ${asOf} · Source workbook updated: ${source} · Published to site: ${displayDate(data.published_at)} · Account status checked: ${displayDate(data.account_status_checked_at)}. Publication does not rerun the Warehouse report.`;
}
export function accountDateSummary(data){
 const r=data.result||{};return `Balance period: ${balancePeriod(r.period)} · Last report refresh: ${displayDate(r.retrieved)} · Published to site: ${displayDate(data.published_at)}`+(r.proration?` · Spending estimate as of: ${displayDate(r.proration.as_of)}`:'')+'. A month in progress may contain incomplete postings.';
}
export function nimbusDateSummary(status){
 if(status.saved)return `Saved dataset published: ${displayDate(status.saved.refreshed_at)} · Source report run date: not recorded · ${Number(status.saved.rows).toLocaleString()} rows · Published by ${status.saved.refreshed_by}. Publishing an export does not run Cognos.`;
 return status.legacyAvailable?'Original SoE-wide history · Source report run date and publication date: not recorded.':'No saved Nimbus export for this unit yet. A user with write or administrator access can publish one.';
}
