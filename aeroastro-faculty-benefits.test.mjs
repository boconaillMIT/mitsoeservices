import test from 'node:test';import assert from 'node:assert/strict';
import {facultyBenefitAttribution} from './src/aeroastro-faculty-benefits.mjs';
import {seasonalForecast} from './public/aeroastro-seasonal-model.mjs';
import {profilesForSource,validateExpenseProfiles} from './src/aeroastro-expense-profile.mjs';
const salary=(gl,ytd,current=0,summer=0)=>({gl,ytd,current,summer});
test('Faculty attribution uses the applicable on/off/reduced rates and excludes other staff and graduate pay',()=>{
 const r=facultyBenefitAttribution([salary('400025',10000),salary('400090',10000),salary('400026',10000),salary('400250',999999),salary('400700',999999)],2027);
 assert.equal(r.regular.ytd,6120);assert.equal(r.summer.ytd,0);assert.equal(r.summerBenefitsRate,.204);assert.equal(r.defaultSummerRate,false);assert.throws(()=>facultyBenefitAttribution([],2028));
});
test('Regular faculty summer actuals and explicit summer salary remain distinguishable; no faculty history has a disclosed default',()=>{
 const r=facultyBenefitAttribution([salary('400040',90000,30000,0),salary('400005',5000,0,5000)],2027);
 assert.deepEqual(r.regular,{ytd:24480,current:8160,summer:0});assert.deepEqual(r.summer,{ytd:1360,current:0,summer:1360});assert.equal(facultyBenefitAttribution([],2027).summerBenefitsRate,.272);assert.equal(facultyBenefitAttribution([],2027).defaultSummerRate,true);
});
test('Faculty benefits follow academic salary while remaining staff benefits stay year-round without subtracting actuals twice',()=>{
 const row={currentBalance:300000,status:'Open',expenseProfile:{asOf:'2026-11-27',facultyBenefitsAdjusted:true,summerBenefitsRate:.272,components:[{label:'Faculty salary',basis:'academic',closedAmount:60000,currentAmount:30000},{label:'Faculty benefits',basis:'academic',closedAmount:16320,currentAmount:8160},{label:'Other staff benefits',basis:'year-round',closedAmount:5000,currentAmount:0}]}};
 const before=JSON.stringify(row),r=seasonalForecast(row,'2026-11-27');assert.equal(r.remaining,238960);assert.equal(r.projected,61040);assert.equal(JSON.stringify(row),before);
 row.summerException={fiscalYear:2027,amount:2500};const extra=seasonalForecast(row,'2026-11-27');assert.equal(extra.summerBenefitsRemaining,680);assert.equal(extra.remaining,242140);assert.equal(extra.projected,57860);
 assert.equal(seasonalForecast({...row,summerException:{fiscalYear:2027,amount:0}},'2026-11-27').remaining,238960);
});
test('Faculty benefits and summer exceptions are preserved in scoped profiles; malformed rates fail closed and older profiles remain compatible',()=>{
 const hash='a'.repeat(64),source={sourceHash:hash,asOf:'2026-11-27',rows:[{account:'9900001'}]},row={account:'9900001',facultyBenefitsAdjusted:true,summerBenefitsRate:.084,defaultSummerRate:false,components:[{label:'Faculty benefits',basis:'academic',closedAmount:1680,currentAmount:840}]},v={schema:1,unit:'aeroastro',sourceHash:hash,asOf:source.asOf,rows:[row]};
 const p=profilesForSource(v,source).get('9900001');assert.equal(p.summerBenefitsRate,.084);assert.equal(p.facultyBenefitsAdjusted,true);assert.throws(()=>validateExpenseProfiles({...v,rows:[{...row,summerBenefitsRate:2}]}));assert.throws(()=>validateExpenseProfiles({...v,rows:[{...row,summerBenefitsRate:'0.084'}]}));assert.equal(profilesForSource(v,{...source,sourceHash:'b'.repeat(64)}).size,0);
 const legacy={expenseProfile:{asOf:source.asOf,components:row.components},summerException:{fiscalYear:2027,amount:1000}};assert.equal(seasonalForecast(legacy,source.asOf).summerBenefitsRemaining,0);
});
