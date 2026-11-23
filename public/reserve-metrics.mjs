// Department wallet balances and SoE's unpaid support obligations are different measures.
export function reserveMetrics(year,{includeFaculty=false,unpaidSoeSupport=null}={}){
 const balance=Number.isFinite(year?.reserve)?year.reserve+(includeFaculty&&Number.isFinite(year.faculty)?year.faculty:0):null;
 const resources=year?.resources,months=balance!==null&&Number.isFinite(resources)&&resources>0?Math.round(balance/(resources/12)*10)/10:null;
 return {balance,months,unpaidSoeSupport};
}
