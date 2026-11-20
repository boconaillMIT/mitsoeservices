export const REVIEWER_DIRECTORY=[
 {key:'hammond',name:'Paula Hammond',label:'Paula',email:'hammond@mit.edu',slot:0,aliases:['hammond','paula','paulahammond','deanhammond','paulathammond']},
 {key:'hamsa',name:'Hamsa Balakrishnan',label:'Hamsa',email:'hamsa@mit.edu',slot:1,aliases:['hamsa','balakrishnan','hamsabalakrishnan']},
 {key:'dplata',name:'Desiree Plata',label:'Desiree',email:'dplata@mit.edu',slot:2,aliases:['dplata','desiree','plata','desireeplata']},
 {key:'oconaill',name:'Brían O’Conaill',label:'Brían (test)',email:'oconaill@mit.edu',slot:4,aliases:['oconaill','brian','brianoconaill','briantest','brianoconailltest']}
];
const normalize=name=>String(name).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z]/gi,'').toLowerCase();
export function reviewerSlot(review,key){const person=REVIEWER_DIRECTORY.find(p=>p.key===key);if(!person)return -1;return review.reviewers.findIndex(v=>person.aliases.includes(normalize(v.name)));}
export function reviewerComplete(review,key){const i=reviewerSlot(review,key);return i>=0&&['1','2','3','4','5'].includes(review.reviewers[i].grade);}
export function reviewerQueue(records,key){return records.filter(r=>(r.review.assignments||[]).includes(key)).map(record=>({...record,complete:reviewerComplete(record.review,key)}));}
