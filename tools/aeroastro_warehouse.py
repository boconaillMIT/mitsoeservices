"""AeroAstro desktop refresh. Fixed read-only SQL; Warehouse passwords stay local."""
import argparse,getpass,json,os,re,sys,urllib.request,urllib.error
from pathlib import Path
from decimal import Decimal
from urllib.parse import urlparse

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'.runtime/warehouse-python'))
API='https://mitsoeservices.netlify.app/.netlify/functions/aeroastro-warehouse'
CENTERS=('061000','061001','061002','061004','061005','061006','061007','061090','061091','061092','061093','061094','061095','061096','061097','061098','061099')
DSN='(DESCRIPTION=(CONNECT_TIMEOUT=15)(ADDRESS=(PROTOCOL=TCP)(HOST=warehouse.mit.edu)(PORT=1521))(CONNECT_DATA=(SID=DWRHS)))'

def read_ticket(uri):
    p=urlparse(uri)
    token=p.path.lstrip('/')
    if p.scheme!='mitsoe-warehouse' or p.netloc!='refresh' or p.query or p.fragment or not re.fullmatch(r'[-_A-Za-z0-9]+\.[a-f0-9]{64}',token) or len(token)>2000:
        raise ValueError('Start the refresh from the AeroAstro accounts page.')
    return token

def controller(token,body=None):
    data=None if body is None else json.dumps(body,allow_nan=False,separators=(',',':')).encode()
    req=urllib.request.Request(API,data=data,headers={'Authorization':'Bearer '+token,**({'Content-Type':'application/json'} if data else {})})
    # Never follow a redirect carrying a refresh authorization to another host.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs):return None
    opener=urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(req,timeout=120) as r:return json.load(r)
    except urllib.error.HTTPError as e:
        try:message=json.loads(e.read(12000)).get('error','Refresh request failed.')
        except Exception:message='Refresh request failed.'
        raise ValueError(message) from None

def load_client():
    import oracledb
    client=Path(os.getenv('ORACLE_HOME',r'C:\oracle\client\product\19.0.0\client_64'))
    if not (client/'oci.dll').exists():raise ValueError('A compatible 64-bit Oracle client is required on this computer.')
    oracledb.init_oracle_client(lib_dir=str(client),config_dir=str(client/'network/admin'))
    return oracledb

def connect(user,password):
    oracledb=load_client()
    c=oracledb.connect(user=user,password=password,dsn=DSN)
    c.call_timeout=180000
    return c

def extract(connection,job):
    if job.get('schema')!=1 or job.get('unit')!='aeroastro' or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',job.get('asOf','')):raise ValueError('Invalid refresh job.')
    inventory=job.get('inventory',[])
    if not 1<=len(inventory)<=999:raise ValueError('Unexpected account inventory size; no data was extracted.')
    accounts={}
    for r in inventory:
        if not re.fullmatch(r'\d{7}',r.get('account','')) or r.get('profitCenter') not in CENTERS or r['account'] in accounts:raise ValueError('Invalid AeroAstro account scope.')
        accounts[r['account']]=r['profitCenter']
    year,month=map(int,(job['asOf'][:4],job['asOf'][5:7]));fy=year+(month>=7);index=(month+5)%12+1
    period=str(fy)+str(index).zfill(2);summer=str(fy)+str(min(2,index)).zfill(2)
    binds={f'a{i}':a for i,a in enumerate(accounts)}
    ids=','.join(':'+k for k in binds)
    centers=','.join("'P"+p+"'" for p in CENTERS)
    scope=f"cc.COST_COLLECTOR_ID IN ({ids}) AND cc.PROFIT_CENTER_ID IN ({centers})"
    def query(cursor,sql,params):
        cursor.execute(sql,params);cols=[c[0] for c in cursor.description]
        return [dict(zip(cols,row)) for row in cursor]
    with connection.cursor() as cursor:
        cursor.arraysize=1000
        cursor.execute('SET TRANSACTION READ ONLY')
        master=query(cursor,f'SELECT cc.COST_COLLECTOR_ID AS "account",cc.PROFIT_CENTER_ID AS "profitCenter" FROM WAREUSER.COST_COLLECTORS_ACCESSIBLE cc WHERE {scope}',binds)
        if len(master)!=len(accounts) or any(accounts.get(r['account'])!=r['profitCenter'].removeprefix('P') for r in master):raise ValueError('Your Warehouse access does not cover the complete verified AeroAstro inventory. No partial update was saved.')
        balances=query(cursor,f'''SELECT cc.COST_COLLECTOR_ID AS "account",cc.PROFIT_CENTER_ID AS "profitCenter",
            b.UNEXPENDED_BALANCE AS "currentBalance",b.FYTD_EXPENSES AS "ytdExpenses",
            b.CURRENT_MONTH_EXPENSES AS "currentExpenses",b.TOTAL_COMMITMENTS AS "commitments"
            FROM WAREUSER.COST_COLLECTORS_ACCESSIBLE cc LEFT JOIN WAREUSER.BALANCES_SUMMARY b
            ON b.COST_COLLECTOR_KEY=cc.COST_COLLECTOR_KEY AND b.FISCAL_PERIOD=:period
            WHERE {scope}''',{**binds,'period':period})
        gl=query(cursor,f'''SELECT cc.COST_COLLECTOR_ID AS "account",cc.PROFIT_CENTER_ID AS "profitCenter",g.GL_ACCOUNT_ID AS "gl",
            SUM(CASE WHEN s.TIME_MONTH_KEY=:period THEN NVL(s.FYTD_AMOUNT,0) ELSE 0 END) AS "ytd",
            SUM(CASE WHEN s.TIME_MONTH_KEY=:period THEN NVL(s.AMOUNT,0) ELSE 0 END) AS "current",
            SUM(CASE WHEN s.TIME_MONTH_KEY=:summer THEN NVL(s.FYTD_AMOUNT,0) ELSE 0 END) AS "summer"
            FROM WAREUSER.COST_COLLECTORS_ACCESSIBLE cc
            JOIN WAREUSER.SUMMARY_STATEMENT_DETAIL s ON s.COST_COLLECTOR_KEY=cc.COST_COLLECTOR_KEY
            JOIN WAREUSER.GL_ACCOUNT_REPORT g ON g.GL_ACCOUNT_KEY=s.GL_ACCOUNT_KEY
            WHERE {scope} AND s.TIME_MONTH_KEY IN (:period,:summer)
            AND g.REPORT_TYPE_CODE='CEMIT-0' AND g.IS_EXPENSE_ACCOUNT='Y' AND g.IS_TRANSFER_ACCOUNT='N'
            AND g.IS_SETTLEMENT_ACCOUNT='N' AND g.LEVEL1_CATEGORY<>'Principal'
            AND g.GL_ACCOUNT_ID NOT IN ('800600','800601','800602','800603','800701')
            GROUP BY cc.COST_COLLECTOR_ID,cc.PROFIT_CENTER_ID,g.GL_ACCOUNT_ID''',{**binds,'period':period,'summer':summer})
    def numeric(rows):return [{k:float(v) if isinstance(v,Decimal) else v for k,v in r.items()} for r in rows]
    return {'schema':1,'asOf':job['asOf'],'period':period,'balances':numeric(balances),'gl':numeric(gl)}

def install():
    if sys.platform!='win32':raise ValueError('This helper installation is for Windows.')
    load_client()
    import winreg
    # This user only. No administrator permissions or Warehouse credentials saved.
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER,r'Software\Classes\mitsoe-warehouse') as key:
        winreg.SetValueEx(key,'',0,winreg.REG_SZ,'MIT SoE Warehouse refresh')
        winreg.SetValueEx(key,'URL Protocol',0,winreg.REG_SZ,'')
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER,r'Software\Classes\mitsoe-warehouse\shell\open\command') as key:
        winreg.SetValueEx(key,'',0,winreg.REG_SZ,f'"{sys.executable}" "{Path(__file__).resolve()}" "%1"')
    print('Warehouse refresh helper installed for this Windows user. No passwords saved.')

def main():
    parser=argparse.ArgumentParser();parser.add_argument('uri',nargs='?');parser.add_argument('--install',action='store_true');args=parser.parse_args()
    if args.install:
        if len(sys.argv)!=2:raise ValueError('Invalid installation arguments.')
        return install()
    token=read_ticket(args.uri or '')
    job=controller(token)
    user=job.get('actor','')
    if not re.fullmatch(r'[a-z][a-z0-9._-]{0,63}',user):raise ValueError('Invalid Warehouse username.')
    print('MIT SoE Services - AeroAstro account refresh')
    print('Direct, read-only connection to warehouse.mit.edu.')
    print('Your Warehouse password stays on this computer and is sent only to MIT Oracle.')
    password=getpass.getpass('Warehouse password for '+user+': ')
    try:connection=connect(user,password)
    finally:password=None
    print('Retrieving verified AeroAstro accounts and seasonal expense details...')
    with connection:bundle=extract(connection,job)
    print('Checking and saving the shared refresh...')
    result=controller(token,{'action':'complete','bundle':bundle})
    if not result.get('saved'):raise ValueError('The refresh was not confirmed. Check the accounts page.')
    print('Updated',result['accounts'],'AeroAstro accounts. Return to the accounts page.')

if __name__=='__main__':
    exit_code=0
    try:main()
    except ValueError as e:exit_code=1;print(str(e))
    except Exception as e:
        exit_code=1
        code=getattr(e.args[0],'code',None) if e.args else None
        print('Refresh stopped. No password was saved. Error type:',type(e).__name__,'Oracle code:',code)
    finally:
        if '--install' not in sys.argv:input('Press Enter to close')
    sys.exit(exit_code)
