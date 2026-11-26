import {PRIVATE_OWNER,KDF_ITERATIONS,PERSON_KEY,UUID,toBase64,fromBase64,validateVault,validateEncryptedNote,exactKeys} from './aeroastro-private-schema.mjs';
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
function cryptoApi(){if(!globalThis.crypto?.subtle||globalThis.isSecureContext===false)throw Error('A secure browser connection is required for private notes.');return globalThis.crypto;}
const random=length=>cryptoApi().getRandomValues(new Uint8Array(length));
const vaultAAD=id=>encoder.encode(JSON.stringify(['aeroastro-private-v1',PRIVATE_OWNER,id,'notebook-key']));
function noteAAD(vaultId,person,id){if(!UUID.test(vaultId)||!PERSON_KEY.test(person)||!UUID.test(id))throw Error('Invalid private-note identity.');return encoder.encode(JSON.stringify(['aeroastro-private-v1',PRIVATE_OWNER,vaultId,person,id]));}
async function derive(passphrase,kdf){
 if(typeof passphrase!=='string'||passphrase.length>1000)throw Error('Enter your notebook passphrase.');const bytes=encoder.encode(passphrase.normalize('NFC'));let material;
 try{material=await cryptoApi().subtle.importKey('raw',bytes,'PBKDF2',false,['deriveKey']);}finally{bytes.fill(0);}
 return cryptoApi().subtle.deriveKey({name:'PBKDF2',salt:fromBase64(kdf.salt,32),iterations:KDF_ITERATIONS,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function createNotebook(passphrase){
 if(typeof passphrase!=='string'||passphrase.normalize('NFC').length<20||passphrase.length>1000)throw Error('Choose a unique passphrase of at least 20 characters.');
 const vaultId=cryptoApi().randomUUID(),kdf={name:'PBKDF2',hash:'SHA-256',iterations:KDF_ITERATIONS,normalization:'NFC',salt:toBase64(random(32))},kek=await derive(passphrase,kdf),raw=random(32),iv=random(12);let key,ciphertext;
 try{key=await cryptoApi().subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);ciphertext=await cryptoApi().subtle.encrypt({name:'AES-GCM',iv,additionalData:vaultAAD(vaultId),tagLength:128},kek,raw);}finally{raw.fill(0);}
 return {vault:validateVault({schema:1,owner:PRIVATE_OWNER,vaultId,kdf,wrappedKey:{iv:toBase64(iv),ciphertext:toBase64(ciphertext)}}),key};
}
export async function unlockNotebook(passphrase,input){
 const vault=validateVault(input);let raw;
 try{const kek=await derive(passphrase,vault.kdf);raw=new Uint8Array(await cryptoApi().subtle.decrypt({name:'AES-GCM',iv:fromBase64(vault.wrappedKey.iv,12),additionalData:vaultAAD(vault.vaultId),tagLength:128},kek,fromBase64(vault.wrappedKey.ciphertext,48)));if(raw.length!==32)throw Error();return await cryptoApi().subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);}catch{throw Error('This passphrase did not unlock the notebook. Existing notes have not changed.');}finally{raw?.fill(0);}
}
export async function encryptPrivateNote(key,vaultId,person,text,id=cryptoApi().randomUUID()){
 if(typeof text!=='string'||!text.trim()||text.length>6000)throw Error('Enter a note of up to 6,000 characters.');const plain=encoder.encode(JSON.stringify({schema:1,text})),iv=random(12);let ciphertext;
 try{ciphertext=await cryptoApi().subtle.encrypt({name:'AES-GCM',iv,additionalData:noteAAD(vaultId,person,id),tagLength:128},key,plain);}finally{plain.fill(0);}
 return validateEncryptedNote({schema:1,vaultId,id,iv:toBase64(iv),ciphertext:toBase64(ciphertext)});
}
export async function decryptPrivateNote(key,vaultId,person,input){
 const note=validateEncryptedNote(input);if(note.vaultId!==vaultId)throw Error('This note belongs to a different notebook.');let raw;
 try{raw=new Uint8Array(await cryptoApi().subtle.decrypt({name:'AES-GCM',iv:fromBase64(note.iv,12),additionalData:noteAAD(vaultId,person,note.id),tagLength:128},key,fromBase64(note.ciphertext,17,40000)));const value=JSON.parse(decoder.decode(raw));if(!exactKeys(value,['schema','text'])||value.schema!==1||typeof value.text!=='string'||!value.text.trim()||value.text.length>6000)throw Error();return value.text;}catch{throw Error('This private note could not be unlocked or verified.');}finally{raw?.fill(0);}
}
