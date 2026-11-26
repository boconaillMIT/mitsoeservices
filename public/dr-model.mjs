export const STATUSES={draft:'Draft',inquiry:'Awaiting requester information',submitted:'Submitted',review:'Under review',information:'More information needed',finance:'Awaiting financial approval',approved:'Approved',partial:'Partially approved',declined:'Declined',withdrawn:'Withdrawn'};
export const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const EDITABLE=['draft','inquiry','information'];
export const CLOSED=['approved','partial','declined','withdrawn'];
export function fail(message,status=400){throw Object.assign(Error(message),{status});}
export function text(value,max=4000){if(typeof value!=='string'||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))fail('Enter valid text (maximum '+max+' characters).');return value.trim();}
export function money(value){if(value===null||value==='')return null;if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>100000000||Math.abs(value*100-Math.round(value*100))>0.00001)fail('Enter a nonnegative dollar amount with at most two decimal places.');return Math.round(value*100)/100;}
export const totalBudget=request=>Math.round(request.budget.reduce((n,r)=>n+Math.round((r.amount||0)*100),0))/100;
export const soePercent=request=>request.members>0&&request.soeMembers!==null?Math.round(request.soeMembers/request.members*1000)/10:null;
export function cleanRequest(input={}){
 const out={};
 for(const key of ['requesterName','requesterEmail','department','organization','organizationType','teamRole','teamEmail','website','title','purpose','beneficiaries','soeConnection','fundUse','previousDetails','otherFunding','correspondence'])out[key]=text(input[key]??'',key==='correspondence'?16000:key==='purpose'||key==='previousDetails'?8000:4000);
 for(const key of ['requesterEmail','teamEmail'])if(out[key]&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out[key]))fail('Enter a valid contact email.');
 if(out.website){let url;try{url=new URL(out.website);}catch{fail('Enter a full website address.');}if(!['https:','http:'].includes(url.protocol)||url.username||url.password)fail('Enter a valid website address.');}
 for(const key of ['activityStart','activityEnd','deadline']){out[key]=text(input[key]??'',10);if(out[key]){const date=new Date(out[key]+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(out[key])||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==out[key])fail('Enter a valid date.');}}
 if(out.activityStart&&out.activityEnd&&out.activityEnd<out.activityStart)fail('The activity end date must follow its start date.');
 for(const key of ['requested','goal','secured'])out[key]=money(input[key]??null);
 for(const key of ['members','soeMembers']){const v=input[key]??null;if(v!==null&&(!Number.isSafeInteger(v)||v<0||v>1000000))fail('Membership counts must be whole numbers.');out[key]=v;}
 if(out.members!==null&&out.soeMembers!==null&&out.soeMembers>out.members)fail('SoE membership cannot exceed total membership.');
 out.previous=input.previous??'unknown';if(!['yes','no','unknown'].includes(out.previous))fail('Choose Yes, No or Unknown for prior requests.');
 if(!Array.isArray(input.budget??[])||(input.budget??[]).length>100)fail('Use at most 100 budget lines.');
 out.budget=(input.budget??[]).map(line=>({description:text(line.description??'',500),amount:money(line.amount??null)}));
 return out;
}
export function submissionErrors(record){
 const r=record.request,errors=[];
 for(const [key,label] of Object.entries({requesterName:'Requester name',requesterEmail:'Requester email',department:'Department',organization:'Organization',organizationType:'Organization type',teamRole:'Your role',title:'Request title',purpose:'Purpose',beneficiaries:'Beneficiaries',soeConnection:'SoE connection',fundUse:'Use of SoE funds',activityStart:'Activity start',activityEnd:'Activity end',deadline:'Funding deadline'}))if(!r[key])errors.push(label+' is required.');
 if(!(r.requested>0))errors.push('Enter the amount specifically requested from SoE.');
 if(!(r.members>0)||r.soeMembers===null)errors.push('Enter total membership and SoE membership counts.');
 if(!r.budget.length||r.budget.some(line=>!line.description||line.amount===null)||totalBudget(r)<=0)errors.push('Complete the basic expense budget.');
 if(r.requested>totalBudget(r))errors.push('The SoE request cannot exceed the expense budget.');
 if(r.requested>1000&&!record.files.some(f=>f.kind==='budget'))errors.push('Requests over $1,000 require an attached itemized budget.');
 return errors;
}
export function visibleRecord(record,staff){
 if(staff)return record;
 const {id,revision,owner,organizationId,status,request,validity,finance,files,history,createdAt,updatedAt}=record;
 const {correspondence,...publicRequest}=request;
 return {id,revision,owner,organizationId,status,request:publicRequest,validity:validity?{at:validity.at}:null,finance:finance?{amount:finance.amount,at:finance.at}:null,files:files.filter(f=>f.kind!=='correspondence'),history:history.filter(h=>!h.internal).map(({action,by,at,message,status})=>({action,by,at,message,status})),createdAt,updatedAt};
}
export function applyAction(record,command,actor,{uuid,now,attachment}={}){
 const staff=actor.canWrite===true,own=record.owner===actor.kerberos;
 const needStaff=()=>{if(!staff)fail('Donation Requests Write access is required.',403);};
 if(!own&&!staff)fail('Request not found.',404);
 const next=structuredClone(record),action=command.action,at=now(),stamp={by:actor.kerberos,at};let message='',internal=false;
 const reset=()=>{next.validity=null;next.finance=null;};
 switch(action){
 case 'save':{
  if(!EDITABLE.includes(record.status))fail('Reopen this request before changing its intake details.',409);
  const request=cleanRequest(command.request);
  // Identity is supplied by the authenticated session, never by requester input.
  if(!staff){request.requesterName=record.request.requesterName;request.requesterEmail=record.request.requesterEmail;request.correspondence=record.request.correspondence;if(record.departmentSource==='directory')request.department=record.request.department;}
  next.request=request;
  if(record.validity||record.finance)reset();
  break;
 }
 case 'submit':{
  if(!EDITABLE.includes(record.status))fail('This request has already been submitted.',409);
  const errors=submissionErrors(record);if(errors.length)fail(errors.join(' '));
  reset();next.status='submitted';break;
 }
 case 'review':needStaff();if(record.status!=='submitted')fail('Only submitted requests can enter review.',409);next.status='review';break;
 case 'information':needStaff();if(!['submitted','review','finance'].includes(record.status))fail('This request is not awaiting review.',409);message=text(command.message??'',8000);if(!message)fail('Enter a requester-visible question.');reset();next.status='information';break;
 case 'validity':needStaff();if(!['submitted','review'].includes(record.status))fail('This request is not awaiting validity approval.',409);{const errors=submissionErrors(record);if(errors.length)fail(errors.join(' '));}next.validity=stamp;next.finance=null;next.status='finance';message=text(command.message??'',8000);break;
 case 'finance':{
  needStaff();if(record.status!=='finance'||!record.validity)fail('Validity approval is required first.',409);
  if(record.validity.by===actor.kerberos)fail('Financial approval requires a different person from the validity approver.',403);
  const amount=money(command.amount),costObject=text(command.costObject??'',100);
  if(!(amount>0)||amount>record.request.requested)fail('Approve a positive amount no greater than the SoE request.');
  if(!costObject)fail('A cost object is required for financial approval.');
  message=text(command.message??'',8000);if(!message)fail('Enter a requester-visible decision message.');
  next.finance={...stamp,amount,costObject};next.status=amount<record.request.requested?'partial':'approved';break;
 }
 case 'decline':needStaff();if(!['submitted','review','finance'].includes(record.status))fail('This request is not awaiting a decision.',409);message=text(command.message??'',8000);if(!message)fail('Enter a requester-visible decision message.');next.finance=null;next.status='declined';break;
 case 'withdraw':if(CLOSED.includes(record.status))fail('This request is already closed.',409);next.status='withdrawn';reset();break;
 case 'reopen':needStaff();if(!CLOSED.includes(record.status))fail('Only a closed request can be reopened.',409);message=text(command.message??'',8000);if(!message)fail('Explain why this request is being reopened.');reset();next.status='information';break;
 case 'reopenFinance':needStaff();if(!['approved','partial'].includes(record.status)||!record.validity)fail('Only an approved request can return to financial review.',409);message=text(command.message??'',8000);if(!message)fail('Explain the financial amendment.');next.finance=null;next.status='finance';break;
 case 'note':needStaff();message=text(command.message??'',8000);if(!message)fail('Enter an internal note.');internal=true;break;
 case 'attach':
  if(!EDITABLE.includes(record.status))fail('Attachments can be added while the request is a draft or needs information.',409);
  if(!attachment)fail('Upload an attachment first.');
  if(attachment.kind==='correspondence')needStaff();
  if(record.files.length>=40)fail('This request has reached its attachment limit.');
  next.files.push(attachment);reset();message=attachment.filename;internal=attachment.kind==='correspondence';break;
 default:fail('Unknown request action.');
 }
 next.revision=uuid();next.updatedAt=at;
 // The complete snapshot is retained atomically with the edit, including superseded approvals.
 // Neither history nor attribution can be supplied by the client.
 next.history.push({action,...stamp,message,internal,status:next.status,snapshot:{request:structuredClone(next.request),files:structuredClone(next.files),validity:structuredClone(next.validity),finance:structuredClone(next.finance)}});
 if(JSON.stringify(next).length>800000)fail('This request has reached its history capacity. Contact the administrator.');
 return next;
}
