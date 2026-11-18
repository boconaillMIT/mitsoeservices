// This flag only REDUCES Brian's existing school-admin access. It never
// authenticates a user or grants access to an otherwise unauthorized login.
const COOKIE='__Host-soe_fake_daf_view';
function requested(event){return Object.entries(event.headers||{}).some(([key,value])=>key.toLowerCase()==='cookie'&&String(value).split(';').some(c=>c.trim()===COOKIE+'=1'));}
function restrict(event,user,current,policy){
 if(!requested(event))return {current,active:false};
 if(policy.normalizeLogin(user.kerberos)!=='oconaill'||policy.effectiveRole(current.data,'oconaill','school')!=='admin')return {denied:true};
 return {active:true,current:{...current,data:{...current.data,users:['oconaill'],grants:[{username:'oconaill',scope:'soe-fake',role:'admin'}],audit:current.data.audit.filter(a=>a.scope==='soe-fake')}}};
}
function banner(){return '<section class="card test-banner" role="status"><strong>SOE Fake · DAF test view</strong><p>Your browser is restricted to this fictional unit. Your real school-administrator grant is unchanged. This is a permissions simulation, not a separate MIT identity.</p><form method="post" action="/testing/soe-fake"><input type="hidden" name="action" value="exit"><button>Exit DAF test view</button></form></section>';}
module.exports={COOKIE,requested,restrict,banner};
