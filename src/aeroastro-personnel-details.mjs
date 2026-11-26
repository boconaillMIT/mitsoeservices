import {PERSONNEL_EXTRA_FIELDS} from '../public/aeroastro-personnel-fields.mjs';
export function mergePersonnelDetails(source,details){
 if(!details)return source;if(!source||details.schema!==1||details.unit!=='aeroastro'||details.sourceHash!==source.sourceHash||!Array.isArray(details.rows)||details.rows.length!==source.rows.length)throw Error('Personnel details do not match the roster');
 const allowed=new Set(source.rows.map(r=>r.id)),extra=new Map();
 for(const row of details.rows){if(!allowed.has(row.appointmentId)||extra.has(row.appointmentId)||row.department!=='Aeronautics and Astronautics'||Object.keys(row).some(k=>k!=='appointmentId'&&!PERSONNEL_EXTRA_FIELDS.includes(k)))throw Error('Invalid personnel details');const {appointmentId,...fields}=row;extra.set(appointmentId,fields);}
 return {...source,rows:source.rows.map(row=>({...row,...extra.get(row.id)}))};
}
