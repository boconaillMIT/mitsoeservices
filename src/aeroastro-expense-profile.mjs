import {seasonalExposure,seasonalComponent} from '../public/aeroastro-seasonal-model.mjs';
export function validateExpenseProfiles(value){
 if(value?.schema!==1||value.unit!=='aeroastro'||!/^[a-f0-9]{64}$/.test(value.sourceHash||'')||!Array.isArray(value.rows)||value.rows.length>5000)throw Error('Invalid expense breakdown');
 seasonalExposure(value.asOf);const seen=new Set();
 for(const row of value.rows){if(!/^\d{7}$/.test(row.account||'')||seen.has(row.account)||!Array.isArray(row.components)||!row.components.length||row.components.length>12)throw Error('Invalid expense account');seen.add(row.account);if(row.facultyBenefitsAdjusted!==undefined&&(row.facultyBenefitsAdjusted!==true||typeof row.summerBenefitsRate!=='number'||!Number.isFinite(row.summerBenefitsRate)||row.summerBenefitsRate<0||row.summerBenefitsRate>1||typeof row.defaultSummerRate!=='boolean'))throw Error('Invalid faculty benefits assumptions');for(const c of row.components){if(!c||Object.keys(c).some(k=>!['label','basis','closedAmount','currentAmount','schedule'].includes(k)))throw Error('Unapproved component field');if(typeof c.label!=='string'||c.label.length>100||!['academic','year-round','scheduled'].includes(c.basis))throw Error('Invalid expense component');seasonalComponent(c,value.asOf);}}
 return value;
}
export function profilesForSource(value,source){
 if(!value||!source||value.sourceHash!==source.sourceHash||value.asOf!==source.asOf)return new Map();
 validateExpenseProfiles(value);const allowed=new Set(source.rows.map(r=>r.account));return new Map(value.rows.filter(r=>allowed.has(r.account)).map(r=>[r.account,{asOf:value.asOf,components:r.components,...(r.facultyBenefitsAdjusted?{facultyBenefitsAdjusted:true,summerBenefitsRate:r.summerBenefitsRate,defaultSummerRate:r.defaultSummerRate}:{})}]));
}
