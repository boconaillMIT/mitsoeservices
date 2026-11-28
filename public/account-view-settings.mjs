export const simpleFinancialKeys=Object.freeze(['currentBalance','ytdExpenses']);
export function accountViewColumns(columns,advanced){return advanced?columns:columns.filter(([key])=>['account','name','currentBalance','ytdExpenses','noteCount'].includes(key));}
export async function loadAccountView(){try{const r=await fetch('/my-settings/data',{cache:'no-store'});if(!r.ok)return 'simple';const v=await r.json();return v.settings?.accountView==='advanced'?'advanced':'simple';}catch{return 'simple';}}
