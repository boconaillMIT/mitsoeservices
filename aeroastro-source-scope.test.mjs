import test from 'node:test';
import assert from 'node:assert/strict';
import {AEROASTRO_PROFIT_CENTERS,validateFinanceSource} from './src/aeroastro-finance-source.mjs';
import {centerInfo} from './public/aeroastro-finance-model.mjs';

const source=rows=>({schema:1,unit:'aeroastro',kind:'accounts',asOf:'2026-11-01',label:'Fictional account source',rows});
const row=(pc,i=0)=>({account:String(9900000+i),profitCenter:pc,name:'Example account',status:'Open',currentBalance:0,ytdExpenses:null,commitments:0});
test('Account imports accept only explicitly discovered AeroAstro profit centers',()=>{
 for(const pc of AEROASTRO_PROFIT_CENTERS)for(const value of [pc,'P'+pc])assert.doesNotThrow(()=>validateFinanceSource(source([row(value)]),'accounts'));
 for(const pc of ['061003','061008','061089','061100','062000','P061003','PP061000','p061000','061000 '])assert.throws(()=>validateFinanceSource(source([row(pc)]),'accounts'),/profit centers/);
});
test('Center choices derive from actual accounts rather than the approved scope list',()=>{
 const rows=[row('P061000'),row('061000',1),row('P061001',2)];
 assert.deepEqual([...new Set(rows.map(r=>centerInfo(r,'profitCenter').key))],['id:061000','id:061001']);
 assert.equal(validateFinanceSource(source(rows),'accounts').rows[0].currentBalance,0);
 assert.equal(validateFinanceSource(source(rows),'accounts').rows[0].ytdExpenses,null);
});
