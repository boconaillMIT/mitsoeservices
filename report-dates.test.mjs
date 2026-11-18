import test from 'node:test';import assert from 'node:assert/strict';
import {displayDate,balancePeriod,walletDateSummary,accountDateSummary,nimbusDateSummary} from './public/report-dates.mjs';
test('fiscal periods map to their actual calendar months and adjustment periods stay explicit',()=>{
 assert.match(balancePeriod('202701'),/July 2026/);assert.match(balancePeriod('202704'),/October 2026/);assert.match(balancePeriod('202707'),/January 2027/);assert.match(balancePeriod('202712'),/June 2027/);assert.match(balancePeriod('202616'),/close \/ adjustment period 16/);assert.equal(balancePeriod('202799'),'not recorded');
});
test('dates distinguish source periods, refresh and publication without inferring a fresh extraction',()=>{
 const data={statement:{balance_year:2026,updated:'2026-09-15'},published_at:'2026-10-28T15:00:00Z',account_status_checked_at:'2026-10-28T14:00:00Z'};const wallet=walletDateSummary(data);assert.match(wallet,/June 30, 2026/);assert.match(wallet,/Source workbook updated: Sep 15, 2026/);assert.match(wallet,/Published to site:/);assert.match(wallet,/does not rerun/);
 const accounts=accountDateSummary({published_at:data.published_at,result:{period:'202704',retrieved:'2026-10-20T15:00:00Z'}});assert.match(accounts,/October 2026/);assert.match(accounts,/Last report refresh: Oct 20/);assert.match(accounts,/Published to site: Oct 28/);
 assert.match(walletDateSummary({...data,statement:{balance_year:2026,updated:'Updated September 2026'}}),/Source workbook updated: September 2026/);
});
test('missing and invalid dates remain unknown; Nimbus upload does not claim to be a new Cognos run',()=>{
 for(const v of [null,undefined,'','not-a-date'])assert.equal(displayDate(v),'not recorded');assert.match(nimbusDateSummary({saved:{rows:12,refreshed_at:'2026-10-28T15:00:00Z',refreshed_by:'person'}}),/Source report run date: not recorded/);assert.match(nimbusDateSummary({legacyAvailable:true}),/publication date: not recorded/);assert.match(nimbusDateSummary({}),/No saved Nimbus export/);assert.match(walletDateSummary({statement:{}}),/Balances as of: not recorded/);
});
