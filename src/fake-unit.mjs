// Hand-authored fixtures only. No Warehouse, Quickbase, or real unit input.
export const SCOPE='soe-fake',SOURCE='SOE Fake — fictional test unit';
export const NOTICE='FICTIONAL TEST DATA — not MIT financial records. No live refresh is connected.';
export const accounts=[
 {account:'9900001',name:'Fictional Teaching Fund',control:'Department',balance:240000,commitments:30000,estimate:45000},
 {account:'9900002',name:'Fictional Robotics Fund',control:'Department',balance:125000,commitments:20000,estimate:25000},
 {account:'9900003',name:'Fictional Faculty Fund',control:'Faculty',balance:85000,commitments:12000,estimate:18000},
 {account:'9900004',name:'Fictional New Fund',control:'Department',balance:50000,commitments:5000,estimate:0}
].map(a=>({...a,after:a.balance-a.commitments-a.estimate}));
export function wallet(){
 const rows=[];
 for(const year of [2024,2025,2026,2027])for(const a of accounts){
  const admin=a.control==='Faculty'?'FC':'DP',scale=(year-2023)/4;
  for(const [type,amount]of [['GIB Carryforward',a.balance*scale],['Expendable Fund Balance',a.balance*.6*scale],['GIB Base',a.balance*.4],['Pool A Payout',a.balance*.035]])rows.push({statement_id:'SOE-FAKE-FY28',unit:SOURCE,cycle:2028,type,year,account:a.account,name:a.name,admin,period:year+'12',status:'Fictional',amount:Math.round(amount*100)/100});
 }
 return {schema:1,scope:SCOPE,source_note:NOTICE,published_at:'2026-10-27T12:00:00Z',statement:{id:'SOE-FAKE-FY28',unit:SOURCE,status:'Verified',cycle:2028,carry_year:2027,balance_year:2026,payout_year:2028,department_carry:415000,faculty_carry:85000,payout:17500,growth:.035},controls:{department_nonrecurring:601750,faculty_nonrecurring:123250,department_balance:186750,faculty_balance:38250,unclassified_balance:0},rows};
}
export const transactions=Array.from({length:24},(_,i)=>{
 const a=accounts[i%4],year=2024+Math.floor(i/8);
 return ['FAKE-NIMBUS-'+String(i+1).padStart(3,'0'),String(year),String((i%12)+1).padStart(2,'0'),'FAKE-SUPERVISOR','46000','Fictional budget entry','TEST',a.account,a.name,'999999','Fictional supplies','Fictional '+(i%2?'equipment':'teaching')+' transaction '+(i+1),'SYNTHETIC TEST RECORD','Fictional Submitter','Fictional Approver','FAKE-DOC-'+(i+1),'1',String(1000+i*125),String(i%3?0:250)];
});
export function noticeHtml(){return `<section class="card test-banner"><strong>${NOTICE}</strong><p><a href="/testing/soe-fake">SOE Fake test controls →</a></p></section>`;}
