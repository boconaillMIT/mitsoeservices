export const PRIVATE_OWNER='tara1013';
export const KDF_ITERATIONS=600000;
export const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const PERSON_KEY=/^[a-f0-9]{64}$/;
export function exactKeys(value,keys){return Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k)));}
export function toBase64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes)));}
export function fromBase64(value,min,max=min){
 if(typeof value!=='string'||value.length>Math.ceil(max/3)*4||!value.length||value.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw Error('Invalid encrypted data.');
 let bytes;try{bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));}catch{throw Error('Invalid encrypted data.');}
 if(bytes.length<min||bytes.length>max||toBase64(bytes)!==value)throw Error('Invalid encrypted data.');return bytes;
}
export function validateVault(v){
 if(!exactKeys(v,['schema','owner','vaultId','kdf','wrappedKey'])||v.schema!==1||v.owner!==PRIVATE_OWNER||!UUID.test(v.vaultId||'')||!exactKeys(v.kdf,['name','hash','iterations','normalization','salt'])||v.kdf.name!=='PBKDF2'||v.kdf.hash!=='SHA-256'||v.kdf.iterations!==KDF_ITERATIONS||v.kdf.normalization!=='NFC'||!exactKeys(v.wrappedKey,['iv','ciphertext']))throw Error('Invalid encrypted notebook.');
 fromBase64(v.kdf.salt,32);fromBase64(v.wrappedKey.iv,12);fromBase64(v.wrappedKey.ciphertext,48);return structuredClone(v);
}
export function validateEncryptedNote(n){
 if(!exactKeys(n,['schema','vaultId','id','iv','ciphertext'])||n.schema!==1||!UUID.test(n.id||'')||!UUID.test(n.vaultId||''))throw Error('Invalid encrypted note.');fromBase64(n.iv,12);fromBase64(n.ciphertext,17,40000);return {schema:1,vaultId:n.vaultId,id:n.id,iv:n.iv,ciphertext:n.ciphertext};
}
