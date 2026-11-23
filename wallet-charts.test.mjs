import test from 'node:test';
import assert from 'node:assert/strict';
import {historyPoints} from './public/wallet-charts.mjs';
const row=(year,admin,amount,extra={})=>({type:'Pool A Payout',year,admin,amount,...extra});
test('chart history sums by year and control, preserving negative values and projection status',()=>{
 const points=historyPoints([row(2027,'DP',100.11),row(2027,'DP',50.22),row(2027,'FC',-20),row(2027,'',5),row(2028,'DP',200,{projection:true}),{type:'GIB Base',year:2027,admin:'DP',amount:9999}],'Pool A Payout');
 assert.deepEqual(points.map(p=>p.year),[2027,2028]);assert.equal(points[0].total,135.33);assert.equal(points[0].department,150.33);assert.equal(points[0].faculty,-20);assert.equal(points[0].other,5);assert.equal(points[1].projection,true);
});
test('missing historical amounts remain unavailable while actual zero is preserved',()=>{
 const points=historyPoints([row(2024,'DP',null),row(2024,'FC',null),row(2025,'DP',0),row(2026,'DP',100),row(2026,'DP',null)],'Pool A Payout');
 assert.equal(points[0].total,null);assert.equal(points[0].department,null);assert.equal(points[0].blanks,2);assert.equal(points[1].total,0);assert.equal(points[2].department,100);assert.equal(points[2].blanks,1);
});

// Budget Office carryforward summaries use SUMIFS: inactive account/year blanks
// in an existing group contribute zero, as in the wallet comparison.
test('carryforward history follows wallet zero totals for inactive account/year entries',()=>{
 const points=historyPoints([{type:'GIB Carryforward',year:2025,admin:'DP',amount:null},{type:'GIB Carryforward',year:2025,admin:'FC',amount:100},{type:'GIB Carryforward',year:2026,admin:'DP',amount:50}],'GIB Carryforward');
 assert.equal(points[0].department,0);assert.equal(points[0].total,100);assert.equal(points[1].department,50);
});
