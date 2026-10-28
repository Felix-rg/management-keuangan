import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tempfile

from fastapi.testclient import TestClient

os.environ['DATABASE_URL']='sqlite:///'+str(Path(tempfile.mkdtemp())/'km_test.sqlite3')
os.environ['SESSION_SECRET']='just-tests-secret-very-long-string-secret-key-more-than-32'
os.environ['APP_PASSWORD']='test-password-not-for-production'
os.environ['APP_USERNAME']='owner'

from app import app

client=TestClient(app)

def login():
    response=client.post('/api/auth/login',json={'username':'owner','password':os.environ['APP_PASSWORD']})
    assert response.status_code==200,response.text
    return response.json()['csrf']

def command(csrf,entity,data,action='create'):
    return client.post('/api/command',json={'entity':entity,'action':action,'data':data},headers={'X-CSRF-Token':csrf})

def bootstrap():
    response=client.get('/api/bootstrap?month=2026-10')
    assert response.status_code==200,response.text
    return response.json()

def test_core_workflow():
    assert client.get('/api/bootstrap').status_code==401
    csrf=login()
    data=bootstrap()
    assert data['accounts'] and data['categories']
    a=data['accounts'][0]['id']
    income_cat=next(c['id'] for c in data['categories'] if c['kind']=='income')
    expense_cat=next(c['id'] for c in data['categories'] if c['kind']=='expense')
    assert command('WRONG','account',{'name':'Bank','kind':'bank','opening_balance':0}).status_code==403
    resp=command(csrf,'account',{'name':'Bank','kind':'bank','opening_balance':0}); assert resp.status_code==200,resp.text
    bank=next(x['id'] for x in bootstrap()['accounts'] if x['name']=='Bank')
    base={'tx_date':'2026-10-12','account_id':a,'note':'uji coba'}
    for obj in [{'kind':'income','amount':100000,'category_id':income_cat},{'kind':'expense','amount':25000,'category_id':expense_cat}, {'kind':'transfer','amount':10000,'to_account_id':bank}]:
        r=command(csrf,'transaction',dict(base,**obj)); assert r.status_code==200,r.text
    data=bootstrap()
    assert data['summary']['income']==100000
    assert data['summary']['expense']==25000
    assert data['summary']['balance']==75000
    tunai=next(x for x in data['accounts'] if x['id']==a)
    b=next(x for x in data['accounts'] if x['id']==bank)
    assert tunai['balance']==65000
    assert b['balance']==10000
    assert command(csrf,'budget',{'category_id':expense_cat,'month':'2026-10','amount':50000}).status_code==200
    assert bootstrap()['budgets'][0]['spent']==25000
    assert command(csrf,'goal',{'name':'Laptop','target':150000}).status_code==200
    g=bootstrap()['goals'][0]['id']
    assert command(csrf,'goal_deposit',{'goal_id':g,'amount':75000,'deposit_date':'2026-10-12'}).status_code==200
    assert bootstrap()['goals'][0]['saved']==75000
    assert command(csrf,'debt',{'kind':'debt','person':'Tetangga','amount':50000,'due_date':'2026-11-01'}).status_code==200
    debt=bootstrap()['debts'][0]['id']
    assert command(csrf,'debt_payment',{'debt_id':debt,'account_id':a,'amount':15000,'paid_date':'2026-10-13'}).status_code==200
    assert command(csrf,'debt_payment',{'debt_id':debt,'account_id':a,'amount':50000,'paid_date':'2026-10-13'}).status_code==400
    updated=bootstrap()
    assert updated['debts'][0]['paid']==15000
    assert updated['summary']['expense']==40000
    assert updated['summary']['balance']==60000
    paytx=next(t for t in updated['transactions'] if t['payment_id'])
    assert command(csrf,'transaction',{'id':paytx['id']},'delete').status_code==400
    # Recurring uses an old date: it should generate exactly once per occurrence, never twice.
    assert command(csrf,'recurring',{'kind':'income','account_id':a,'category_id':income_cat,'amount':3000,'interval':'yearly','next_date':'2025-10-01','note':'annual bonus','active':True}).status_code==200
    r=client.post('/api/recurring/process',headers={'X-CSRF-Token':csrf});assert r.status_code==200,r.text
    assert r.json()['processed']==2
    r=client.post('/api/recurring/process',headers={'X-CSRF-Token':csrf}); assert r.json()['processed']==0
    data=bootstrap()
    assert data['summary']['income']==103000
    assert data['summary']['balance']==66000
    out=client.get('/api/backup');assert out.status_code==200
    assert out.json()['tables']['transactions']
    assert out.headers['Cache-Control']=='no-store, private'
    assert client.post('/api/auth/logout',headers={'X-CSRF-Token':csrf}).status_code==200
    assert client.get('/api/bootstrap').status_code==401


def test_login_attempts_persisted():
    for n in range(8):
        r=client.post('/api/auth/login',json={'username':'owner','password':'wrong'})
        assert r.status_code==401,(n,r.text)
    r=client.post('/api/auth/login',json={'username':'owner','password':'wrong'})
    assert r.status_code==429,r.text


def test_health_and_database_status():
    res=client.get('/health')
    assert res.status_code==200
    assert res.json()['version']=='2.1'
    res=client.get('/health/db')
    assert res.status_code==200, res.text
    assert res.json()['database']=='connected'


def test_vercel_runtime_when_public_not_in_function_bundle():
    """Vercel CDNs the /public directory, so it may not exist in /var/task."""
    import subprocess
    import shutil
    from pathlib import Path
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(__file__).resolve().parents[1]
        for filename in ('app.py', 'database.py', 'models.py'):
            shutil.copy(source / filename, Path(tmp) / filename)
        code = """from app import app
from fastapi.testclient import TestClient
c=TestClient(app, follow_redirects=False)
assert c.get('/health').status_code == 200
r=c.get('/')
assert r.status_code == 307 and r.headers['location'] == '/index.html'
"""
        env=os.environ.copy()
        env['VERCEL']='1'
        env['PYTHONPATH']=tmp
        r=subprocess.run([sys.executable, '-c', code], cwd=tmp, env=env,
                         capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
