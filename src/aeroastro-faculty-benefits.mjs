// FY2027 rates verified 2026-11-27 against MIT RAS:
// https://ras.mit.edu/rates/employee-benefits-eb-rates
// GL applicability: https://ras.mit.edu/document/eb-vacation-rate-applicability-chart-april-2015
// Attribution is an estimate from salary GLs, not employee-level benefit transactions.
const rates=Object.freeze({on:.272,off:.256,reduced:.084});
const regular=Object.freeze({'400025':'on','400026':'reduced','400040':'on','400041':'reduced','400090':'off','400105':'off'});
const summer=Object.freeze({'400005':'on','400006':'reduced','400070':'off'});
const round=n=>Math.round(n*100)/100;
export function facultyBenefitAttribution(salaries,fiscalYear){
 if(fiscalYear!==2027)throw Error('Verify MIT benefit rates for this fiscal year before importing.');
 const output={regular:{ytd:0,current:0,summer:0},summer:{ytd:0,current:0,summer:0}};
 let base=0,weighted=0;
 for(const r of salaries){const kind=regular[r.gl]?'regular':summer[r.gl]?'summer':null;if(!kind)continue;
  const rate=rates[(kind==='regular'?regular:summer)[r.gl]];
  for(const field of ['ytd','current','summer']){if(typeof r[field]!=='number'||!Number.isFinite(r[field])||Math.abs(r[field])>1e13)throw Error('Invalid salary component');output[kind][field]+=r[field]*rate;}
  const weight=Math.max(0,r.ytd);base+=weight;weighted+=weight*rate;
 }
 for(const kind of ['regular','summer'])for(const field of ['ytd','current','summer'])output[kind][field]=round(output[kind][field]);
 return {...output,summerBenefitsRate:base?weighted/base:rates.on,defaultSummerRate:!base};
}
