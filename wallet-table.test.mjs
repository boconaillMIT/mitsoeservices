import test from 'node:test';
import assert from 'node:assert/strict';
import {walletRows} from './public/wallet-table.mjs';
const row=(account,amount,extra={})=>({account,amount,type:'Balance',year:2026,admin:'DP',...extra});
const options={type:'Balance',year:2026};
test('largest amounts across all 1700 records precede pagination; original data is unchanged',()=>{
 const source=Array.from({length:1700},(_,i)=>row(String(1000000+i),i));
 const sorted=walletRows(source,options);
 assert.equal(sorted[0].amount,1699);assert.equal(sorted[99].amount,1600);assert.equal(sorted[100].amount,1599);assert.equal(source[0].amount,0);
});
test('numeric amount sorting preserves negatives and zero and places unavailable last in either direction',()=>{
 const source=[row('1',null),row('2',-20),row('3',0),row('4','100'),row('5','invalid'),row('6','')];
 assert.deepEqual(walletRows(source,options).map(r=>r.account),['4','3','2','1','5','6']);
 assert.deepEqual(walletRows(source,{...options,sort:'amount-asc'}).map(r=>r.account),['2','3','4','1','5','6']);
});
test('amount ranges are inclusive and combine with cost object, control, resource, year and name filters',()=>{
 const source=[row('1234',0,{name:'Target'}),row('1235',100,{name:'Target'}),row('1236',101,{name:'Target'}),row('1237',null,{name:'Target'}),row('1238',50,{name:'Target',admin:'FC'}),row('1239',50,{name:'Target',year:2025}),row('2234',50,{name:'Target'}),row('1230',50,{name:'Other'}),row('1231',50,{name:'Target',type:'Other'})];
 assert.deepEqual(walletRows(source,{...options,costObject:'123',search:'target',minimum:'0',maximum:'100',control:'DP'}).map(r=>r.account),['1235','1234']);
 assert.equal(walletRows(source,{...options,minimum:100,maximum:0}).length,0);
 assert.deepEqual(walletRows([row('1',-10),row('2',0)],{...options,maximum:'0'}).map(r=>r.amount),[0,-10]);
});
test('cost objects sort naturally in both directions and filters do not treat zero as missing',()=>{
 const source=[row('10',1),row('2',0),row('1',2)];
 assert.deepEqual(walletRows(source,{...options,sort:'account-asc'}).map(r=>r.account),['1','2','10']);
 assert.deepEqual(walletRows(source,{...options,sort:'account-desc'}).map(r=>r.account),['10','2','1']);
 assert.deepEqual(walletRows(source,{...options,minimum:0,maximum:0}).map(r=>r.account),['2']);
});
test('closed code 3 accounts are excluded; expired dates and other termination codes remain visible',()=>{
 const source=[row('2020085',100,{term_code:'3',is_closed:'Y'}),row('2',20,{term_code:3}),row('3',30,{is_closed:'Y'}),row('4',40,{term_code:'2',end_date:'2020-01-01'}),row('5',50,{term_code:'1'}),row('6',0)];
 assert.deepEqual(walletRows(source,options).map(r=>r.account),['5','4','6']);
});
