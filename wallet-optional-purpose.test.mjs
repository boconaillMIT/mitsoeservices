import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startOptionalPurposeView} from './public/wallet-purpose-view.mjs';

test('a wallet without the optional purpose section does not fail after data loads',()=>{
 const original=globalThis.document;
 try{
  globalThis.document={querySelector:()=>null};
  assert.doesNotThrow(()=>startOptionalPurposeView({scope:'school',rows:[]}));
 }finally{globalThis.document=original;}
});
