import access from './access.cjs';
import policy from './policy.cjs';
import units from './units.cjs';
import navigation from './navigation.cjs';
import dafContacts from './daf-contacts.cjs';
import {PILOT_UNITS} from './account-inventory.mjs';
import {allocationCard} from './allocations-page.mjs';
import {unitCards} from './unit-cards.mjs';
export function hubLayout(title,body,manage=false,audience='',schoolAdmin=false,schoolAccess=schoolAdmin,visibility={},assets='',bodyAttrs=''){return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · MITSOEServices</title><link rel="stylesheet" href="/style.css">${assets}</head><body${bodyAttrs}>${navigation.mainNavigation({manage,schoolAdmin,schoolAccess,visibility})}<main><header><span>SCHOOL OF ENGINEERING</span><span class="badge">MIT sign-in verified</span></header><section class="intro"><div class="eyebrow">UNIT RESOURCES</div><h1>${title}</h1>${audience}</section>${body}</main></body></html>`;}
export function unitLanding(scope,section,manage=false,audience='',schoolAdmin=false,schoolAccess=schoolAdmin,visibility={},canUpload=false,unitAdmin=false){
 const u=units.ALL_UNITS[scope],limited=section==='limited';
 const title=u.label+(limited?' Limited Access':' Full access');
 const shown=visibility.features||{};
 const walletItems=units.walletsForUnit(scope);
 const walletSection=shown.wallets===false?'':units.walletBlocked(scope)?`<section class="card"><h2>Financial resources (currently blocked)</h2><ul>${walletItems.map(key=>`<li>${units.WALLETS[key].label} resource wallet</li>`).join('')}</ul><p>Financial resources are temporarily blocked</p></section>`:`<section class="card"><h2>Wallets</h2>${walletItems.map(key=>`<a class="desktop" href="${units.unitPath(key,'wallet')}">${units.WALLETS[key].label} resource wallet →</a>`).join('')}<p>Carryforward, expendable balances, payout estimates, and account history.</p></section>`;
 const daf=scope==='soe-fake'?'Brian O’Conaill (fictional unit test DAF)':dafContacts[scope];
 const dafLine=daf?`<p>${scope==='aeroastro'?'Current':'As of 10/26/26 the current'} ${u.label} DAF: ${daf}.</p>`:'';
 const files=`<section class="card unit-files" aria-labelledby="unit-files-heading"><div class="file-section-heading"><div><h2 id="unit-files-heading">Files · ${limited?'Limited Access':'Full access'}</h2><p>Available to everyone listed above who can view this page. Files on the other access page are kept separately.</p></div></div><p id="unit-files-status" role="status">Loading this page’s files…</p><div class="wallet-table"><table class="unit-files-table"><thead><tr><th>File</th><th>Size</th><th>Uploaded by</th><th>Uploaded (Eastern Time)</th><th>Access</th></tr></thead><tbody id="unit-file-list"></tbody></table></div>${canUpload?`<form id="unit-file-upload" class="unit-file-upload"><h3>Upload a file to ${title}</h3><label for="unit-file-input">Choose a file <span class="small">(up to 4 MB)</span></label><input id="unit-file-input" name="file" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.rtf,.png,.jpg,.jpeg,.gif,.webp" required disabled><p class="small">PDFs, Office documents, spreadsheets, text files, and images. Every upload is kept as a separate entry.</p><button id="unit-file-submit" type="submit" disabled>Upload to ${u.label} ${limited?'Limited Access':'Full access'}</button><p id="unit-file-upload-status" role="status"></p></form>`:'<p class="small">You have read-only access to files on this page. A user with write or administrator access can upload files.</p>'}</section>`;
 const inventory=shown['account-inventory']!==false&&unitAdmin&&PILOT_UNITS.includes(scope)?`<section class="card"><h2>Account-list review (pilot)</h2><p>Privately review an extract from your own Warehouse access. Save an account inventory without publishing balances or changing permissions.</p><a class="desktop" href="/units/${scope}/account-list">Review ${u.label} account list →</a></section>`:'';
 const nimbus=shown.nimbus===false?'':`<section class="card"><h2>Nimbus Search (under construction)</h2><p>Search your unit’s saved transaction history. Refresh only when newer information is needed.</p><a class="desktop" href="${units.unitPath(scope).replace(/\/full$/,'/nimbus')}">${u.label} Nimbus Search (under construction) →</a></section>`;
 const accountReview=shown['account-review']===false?'':`<section class="card"><h2>Account review &amp; notes</h2><p>Approved unit accounts, follow-up items, and notes shared within Full access.</p><a class="desktop" href="${units.unitPath(scope).replace(/\/full$/,'/account-review')}">${u.label} account review →</a></section>`;
 const commitments=shown.commitments===false?'':`<section class="card"><h2>Commitments &amp; payments</h2><p>Recorded SoE commitments to ${u.label}, with open commitments and payment schedules by fiscal year.</p><a class="desktop" href="${units.unitPath(scope).replace(/\/full$/,'/commitments')}">${u.label} commitments &amp; payments →</a></section>`;
 const finance=scope==='aeroastro'&&visibility.aeroastroFinance&&shown['aeroastro-finance']!==false?'<section class="card"><h2>AeroAstro finance workspace</h2><p>Account balances, spending estimates and shared account notes, plus the department appointment roster.</p><a class="desktop" href="/units/aeroastro/finance/accounts">Accounts & year-end outlook →</a><a class="desktop" href="/units/aeroastro/finance/people">People & appointments →</a><p>DAF: Tara Iovanna · tara1013@mit.edu</p></section>':'';
 const body=limited?`<section class="card"><h2>Shared materials</h2><p>A space for ${u.label} staff resources, guidance, and materials approved for limited access.</p>${dafLine}</section>${files}`:`${finance}${walletSection}${inventory}${shown.allocations===false?'':allocationCard(scope)}${accountReview}${commitments}${nimbus}${files}<section class="card"><h2>Unit resources</h2><a class="desktop" href="${units.unitPath(scope,'limited')}">${u.label} Limited Access →</a><p>Additional unit tools and materials can be added here.</p></section>`;
 return hubLayout(title,body,manage,audience,schoolAdmin,schoolAccess,visibility,'<script src="/unit-files.js" defer></script><script type="module" src="/unit-allocations.js"></script>',` data-file-unit="${scope}" data-file-audience="${section}" data-allocation-unit="${scope}"`);
}
function createDirectoryHandler(group,authorize=access.authorize){const other=group==='other',title=other?'Other units':'Academic units',path=other?'/other-units':'/academic-units';return async event=>{
 if(event.httpMethod!=='GET')return {statusCode:405,headers:access.noStore,body:'GET required'};
 const result=await authorize(event,{scope:'any',audience:'limited'});
 if(result.statusCode===401)return {statusCode:302,headers:{...access.noStore,Location:'/.netlify/functions/auth-login?returnTo='+encodeURIComponent(path)},body:''};
 if(!result.user)return result;
 if(!(other?result.navigation?.other:result.navigation?.academic))return {statusCode:403,headers:access.noStore,body:'Your account is not authorized for this directory.'};
 const cards=result.navigation?.compactUnits?unitCards(result):Object.entries(other?units.OTHER_UNITS:units.UNITS).flatMap(([scope,u])=>{
  const full=policy.effectiveRole(result.policy.data,result.kerberos,scope,'full');
  const limited=policy.effectiveRole(result.policy.data,result.kerberos,scope,'limited');
  if(!full&&!limited)return [];
  return [`<section class="card"><h2>${u.name}</h2>${full?`<a class="desktop" href="${units.unitPath(scope)}">${u.label} Full access →</a>`:''}${limited?`<a class="desktop" href="${units.unitPath(scope,'limited')}">${u.label} Limited Access →</a>`:''}</section>`];
 }).join('');
 return {statusCode:200,headers:{...access.noStore,'Content-Type':'text/html; charset=utf-8'},body:hubLayout(result.navigation?.compactUnits?'Your units':title,`<div class="unit-directory">${cards}</div>`,result.canManage,'',result.admin,result.schoolAccess,result.navigation)};
};}
export function createAcademicHandler(authorize=access.authorize){return createDirectoryHandler('academic',authorize);}
export function createOtherHandler(authorize=access.authorize){return createDirectoryHandler('other',authorize);}
export const handler=createAcademicHandler();
