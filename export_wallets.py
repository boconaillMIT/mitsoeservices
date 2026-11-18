"""Read verified QB wallets into local unit snapshots; credentials remain local."""
import json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
units=json.loads(subprocess.check_output(['node','-p',"JSON.stringify(require('./netlify-space/src/units.cjs').WALLETS)"],cwd=ROOT,text=True))
sys.path.insert(0,str(ROOT/'MITSOEServices-Worker'))
from worker_tools import environment
os.environ.update(environment())
clients=sorted((ROOT/'MITSOEServices-Worker/oracle-client').glob('instantclient_*/oci.dll'))
if clients:os.environ.setdefault('ORACLE_CLIENT_LIB_DIR',str(clients[-1].parent))
sys.path.insert(0,str(ROOT))
from sync_app import core,resources,report,wallet_accounts
statements=resources.group_units(2028,'all')
raw=resources.unpack(report.query_all(resources.DETAILS,list(resources.DETAIL_FIELDS),"{10.EX.'2028'}"),resources.DETAIL_FIELDS)
statuses=wallet_accounts.account_status(raw)
status_checked=core.now().isoformat()
destination=ROOT/'.runtime/wallets'
destination.mkdir(parents=True,exist_ok=True)
published=core.now().isoformat()
fields=('statement_id','cycle','unit','type','year','period','amount','status','projection','account','name','admin','pool','classification','description')
for scope,unit in units.items():
    candidates=[s for s in statements if s['unit']==unit['source']]
    if len(candidates)!=1:raise ValueError('Expected exactly one verified statement for '+scope)
    s=candidates[0]
    if scope=='school' and s['sha256']!='50efc00db4f8753c2cba04b479539c7157db24f4f2592b6c2a94577b13c64e85':raise ValueError('School wallet does not match supplied workbook')
    rows=[{k:r[k] for k in fields} for r in raw if report.record_id(r['statement_id'])==report.record_id(s['id']) and r['unit']==s['unit'] and r['cycle']==s['cycle']]
    for row in rows:row['statement_id']=report.record_id(row['statement_id'])
    rows=wallet_accounts.annotate(rows,statuses)
    balances=[r for r in rows if r['type']=='Expendable Fund Balance' and r['year']==s['balance_year']]
    controls={k+'_balance':v for k,v in resources.control_totals(balances).items()}
    for k in ('department','faculty'):
        a,b=s[k+'_carry'],controls[k+'_balance']
        controls[k+'_nonrecurring']=None if a is None or b is None else float(a)+float(b)
    summary={k:v for k,v in s.items() if k not in ('source','sha256')}
    data={'schema':1,'scope':scope,'published_at':published,'statement':summary,'controls':controls,'rows':rows,'account_status_checked_at':status_checked,'source_note':'Verified Quickbase wallet records; source fiscal periods shown. This refresh does not run a new Warehouse extract.'}
    text=json.dumps(data,default=str,allow_nan=False,separators=(',',':'))
    for name in ('QB_USER_TOKEN','DW_PASSWORD'):
        assert not os.environ.get(name) or os.environ[name] not in text
    (destination/(scope+'.json')).write_text(text,encoding='utf-8')
    print(json.dumps({'unit':scope,'records':len(rows),'bytes':len(text.encode())}))
