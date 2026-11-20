export const REVIEWER_DIRECTORY=[
 {key:'hammond',name:'Paula Hammond',label:'Paula',email:'hammond@mit.edu',slot:0,aliases:['hammond','paula','paulahammond','deanhammond','paulathammond']},
 {key:'hamsa',name:'Hamsa Balakrishnan',label:'Hamsa',email:'hamsa@mit.edu',slot:1,aliases:['hamsa','balakrishnan','hamsabalakrishnan']},
 {key:'dplata',name:'Desiree Plata',label:'Desiree',email:'dplata@mit.edu',slot:2,aliases:['dplata','desiree','plata','desireeplata']},
 {key:'oconaill',name:'Brían O’Conaill',label:'Brían (test)',email:'oconaill@mit.edu',slot:4,aliases:['oconaill','brian','brianoconaill','briantest','brianoconailltest']}
];
export const MAX_RCT_REVIEWERS=100;
export const REVIEWER_KEY=/^[a-z0-9][a-z0-9._-]{0,99}$/;
export function reviewerContact(value){
 if(!value||Object.keys(value).some(k=>!['email','name'].includes(k))||typeof value.email!=='string'||value.email.trim().length>254||!/^[a-z0-9][a-z0-9._+-]*@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value.email.trim()))throw Error('Enter one valid reviewer email address.');
 if(value.name!==undefined&&(typeof value.name!=='string'||value.name.length>100||/[\x00-\x1f\x7f]/.test(value.name)))throw Error('Reviewer names must contain no more than 100 characters.');
 const email=value.email.trim().toLowerCase(),name=value.name?.trim()||email;return {email,name,label:name};
}
export function reviewerIdentity(directory,viewer,email=''){const normalized=String(email).toLowerCase();return directory.find(p=>normalized&&p.email.toLowerCase()===normalized)?.key||directory.find(p=>p.key===viewer||p.email.toLowerCase()===String(viewer).toLowerCase()+'@mit.edu')?.key||viewer;}
const normalize=name=>String(name).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z]/gi,'').toLowerCase();
export function reviewerSlot(review,key,directory=REVIEWER_DIRECTORY){const person=directory.find(p=>p.key===key);if(!person)return -1;const linked=review.reviewers.findIndex(v=>v.reviewerKey===key);if(linked>=0)return linked;return review.reviewers.findIndex(v=>!v.reviewerKey&&((person.aliases||[]).includes(normalize(v.name))||String(v.name).trim().toLowerCase()===person.email.toLowerCase()));}
export function reviewerScoreSlot(review,key,directory=REVIEWER_DIRECTORY){const existing=reviewerSlot(review,key,directory);if(existing>=0)return existing;const person=directory.find(p=>p.key===key);if(!person)return -1;if(Number.isInteger(person.slot)&&review.reviewers[person.slot]&&!review.reviewers[person.slot].name.trim()&&!review.reviewers[person.slot].grade)return person.slot;const blank=review.reviewers.findIndex(v=>!v.name.trim()&&!v.grade&&!v.comments&&!v.reviewerKey);return blank>=0?blank:review.reviewers.length<MAX_RCT_REVIEWERS?review.reviewers.length:-1;}
export function reviewerComplete(review,key,directory=REVIEWER_DIRECTORY){const i=reviewerSlot(review,key,directory);return i>=0&&!!review.reviewers[i].name.trim()&&['1','2','3','4','5'].includes(review.reviewers[i].grade);}
export function reviewerQueue(records,key,directory=REVIEWER_DIRECTORY){return records.filter(r=>(r.review.assignments||[]).includes(key)).map(record=>({...record,complete:reviewerComplete(record.review,key,directory)}));}
