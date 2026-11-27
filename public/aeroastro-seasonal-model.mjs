// September–May academic year and June–August summer, confirmed by the user.
// Inputs must be reconciled expense components, not an inferred split of account totals.
export function seasonalExposure(asOf){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(asOf||'')||!Number.isFinite(Date.parse(asOf))||new Date(asOf+'T00:00:00Z').toISOString().slice(0,10)!==asOf)throw Error('A valid reporting date is required.');
 const d=new Date(asOf+'T00:00:00Z'),month=d.getUTCMonth()+1,fyMonth=(month+5)%12,academic=m=>m>=9||m<=5;
 const months=Array.from({length:12},(_,i)=>(i+6)%12+1);
 return {fiscalYear:d.getUTCFullYear()+(month>=7?1:0),month,closedMonths:fyMonth,closedAcademicMonths:months.slice(0,fyMonth).filter(academic).length,futureMonths:11-fyMonth,futureAcademicMonths:months.slice(fyMonth+1).filter(academic).length,currentAcademic:academic(month)};
}
export function seasonalComponent(component,asOf){
 const t=seasonalExposure(asOf),amount=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e13;
 if(!['academic','year-round','scheduled'].includes(component.basis))throw Error('Choose an explicit expense pattern.');
 const exception=component.summerRemaining??0;if(!amount(exception)||exception<0)throw Error('Invalid summer exception.');
 if(component.basis==='scheduled'){
  if(!Array.isArray(component.schedule)||component.schedule.some(x=>!/^\d{4}-\d{2}-\d{2}$/.test(x.date)||!Number.isFinite(Date.parse(x.date))||new Date(x.date+'T00:00:00Z').toISOString().slice(0,10)!==x.date||!amount(x.amount)||x.amount<0))throw Error('A dated expense schedule is required.');
  const fyEnd=t.fiscalYear+'-06-30';return {remaining:Math.round((component.schedule.filter(x=>x.date>asOf&&x.date<=fyEnd).reduce((sum,x)=>sum+x.amount,0)+exception)*100)/100,monthlyRate:null,basis:'scheduled'};
 }
 if(!amount(component.closedAmount)||!amount(component.currentAmount))throw Error('Verified closed-period and current-period expenses are required.');
 const ay=component.basis==='academic',observed=ay?t.closedAcademicMonths:t.closedMonths,future=ay?t.futureAcademicMonths:t.futureMonths,currentActive=!ay||t.currentAcademic;
 if(!future&&!currentActive)return {remaining:exception,monthlyRate:null,basis:component.basis};
 if(!observed)return {remaining:null,monthlyRate:null,basis:component.basis,reason:'No complete matching months to establish a rate.'};
 // Summer actuals never enter the academic closedAmount; they remain in posted balances.
 const monthlyRate=Math.max(0,component.closedAmount/observed),currentRemaining=currentActive?Math.max(0,monthlyRate-Math.max(0,component.currentAmount)):0;
 return {remaining:Math.round((monthlyRate*future+currentRemaining+exception)*100)/100,monthlyRate,basis:component.basis};
}
export function seasonalForecast(row,asOf){
 const unavailable={annual:null,remaining:null,projected:null,seasonal:true};
 if(row.status==='Closed')return unavailable;
 const p=row.expenseProfile;
 if(!p||p.asOf!==asOf||!Array.isArray(p.components)||!p.components.length)return {...unavailable,reason:'A matching expense breakdown is required.'};
 try{
  const parts=p.components.map(c=>({...c,...seasonalComponent(c,asOf)}));
  if(parts.some(c=>c.remaining===null))return {...unavailable,reason:'A complete matching period is required.'};
  const fy=seasonalExposure(asOf).fiscalYear,extra=row.summerException?.fiscalYear===fy?row.summerException.amount:0;
  if(typeof extra!=='number'||!Number.isFinite(extra)||extra<0)throw Error('Invalid exception');
  const remaining=Math.round((parts.reduce((s,c)=>s+c.remaining,0)+extra)*100)/100,current=row.currentBalance;
  return {annual:null,remaining,projected:typeof current==='number'&&Number.isFinite(current)?Math.round((current-remaining)*100)/100:null,seasonal:true,parts,summerRemaining:extra};
 }catch{return {...unavailable,reason:'The expense breakdown could not be verified.'};}
}
