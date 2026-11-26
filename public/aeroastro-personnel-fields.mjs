export const PERSONNEL_EXTRA_FIELDS=['department','employeeId','employmentDate','yearsSinceHire','visaExpirationDate','residencyStatus','i9ExpirationDate','officeAddress','officePhone'];
export const PERSONNEL_SECTIONS=[
 ['Identity & contact',[['name','Full name'],['employeeId','MIT employee ID'],['department','Department'],['category','Employee type'],['email','Work email'],['officeAddress','Office address'],['officePhone','Office phone']]],
 ['Employment',[['employmentDate','Current employment date','date'],['yearsSinceHire','Years since last hire','years'],['additionalAppointments','Additional appointments in source','boolean']]],
 ['Appointment & compensation',[['jobTitle','Job title'],['positionId','Position ID'],['position','Position title'],['startDate','Appointment begins','date'],['endDate','Appointment ends','end'],['salary','Annual salary','money'],['hourlyRate','Hourly rate','rate'],['fte','Employment percentage','percent']]],
 ['Work authorization · source record',[['visaExpirationDate','Visa expiration date','date'],['residencyStatus','Residency status'],['i9ExpirationDate','I-9 expiration date','date']]]
];
export function personAppointments(rows,person){return person.employeeId?rows.filter(r=>r.employeeId===person.employeeId):rows.filter(r=>r.id===person.id);}
