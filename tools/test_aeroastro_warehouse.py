import importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('warehouse',Path(__file__).with_name('aeroastro_warehouse.py'))
worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)

class Cursor:
    def __init__(self):self.calls=[];self.description=[];self.rows=[]
    def __enter__(self):return self
    def __exit__(self,*args):pass
    def execute(self,sql,params=None):
        self.calls.append((sql,params))
        if 'SET TRANSACTION' in sql:return
        if 'BALANCES_SUMMARY' in sql:
            self.description=[(k,) for k in ['account','profitCenter','currentBalance','ytdExpenses','currentExpenses','commitments']]
            self.rows=[('9990001','P061000',1000,200,30,5)]
        elif 'SUMMARY_STATEMENT_DETAIL' in sql:
            self.description=[(k,) for k in ['account','profitCenter','gl','ytd','current','summer']]
            self.rows=[('9990001','P061000','420000',200,30,10)]
        else:
            self.description=[('account',),('profitCenter',)];self.rows=[('9990001','P061000')]
    def __iter__(self):return iter(self.rows)

class Connection:
    def __init__(self):self.c=Cursor()
    def cursor(self):return self.c

class WarehouseTests(unittest.TestCase):
    def test_only_site_refresh_uris_are_accepted(self):
        token='abc.'+'a'*64
        self.assertEqual(worker.read_ticket('mitsoe-warehouse://refresh/'+token),token)
        for value in ['https://example.test/'+token,'mitsoe-warehouse://other/'+token,'mitsoe-warehouse://refresh/'+token+'?url=https://other.test','mitsoe-warehouse://refresh/invalid']:
            with self.assertRaises(ValueError):worker.read_ticket(value)

    def test_queries_are_read_only_and_bound_to_approved_accounts_and_profit_centers(self):
        c=Connection();result=worker.extract(c,{'schema':1,'unit':'aeroastro','asOf':'2026-11-27','inventory':[{'account':'9990001','profitCenter':'061000'}]})
        self.assertEqual(result['period'],'202705');self.assertEqual(c.c.calls[0][0],'SET TRANSACTION READ ONLY')
        for sql,params in c.c.calls[1:]:
            self.assertIn('cc.COST_COLLECTOR_ID IN (:a0)',sql)
            self.assertIn('cc.PROFIT_CENTER_ID IN',sql)
            self.assertEqual(params['a0'],'9990001')
            self.assertNotIn('P060000',sql)
            self.assertNotIn('9990001',sql)
        self.assertEqual(c.c.calls[-1][1]['summer'],'202702')

    def test_foreign_and_duplicate_accounts_are_rejected_before_query(self):
        for inventory in [[{'account':'9990001','profitCenter':'060000'}],[{'account':'9990001','profitCenter':'061000'}]*2]:
            c=Connection()
            with self.assertRaises(ValueError):worker.extract(c,{'schema':1,'unit':'aeroastro','asOf':'2026-11-27','inventory':inventory})
            self.assertEqual(c.c.calls,[])

if __name__=='__main__':unittest.main()
