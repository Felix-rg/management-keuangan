"""Keuangan Mandiri: single-owner financial tracker on Vercel + Neon PostgreSQL.

The API is protected by a signed HttpOnly session and CSRF header. The repository
contains no login credentials or DB secrets. Money amounts are INTEGER rupiah.
"""
import calendar
import hashlib
import hmac
import os
import re
import secrets
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response, RedirectResponse
from fastapi.staticfiles import StaticFiles
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy import and_, case, func, or_
from sqlalchemy.exc import IntegrityError

from database import session_factory
from models import Account, Budget, Category, Debt, DebtPayment, Goal, GoalDeposit, LoginAttempt, Recurring, Transaction

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

APP_NAME = 'Keuangan Mandiri'
app = FastAPI(title=APP_NAME, docs_url=None, redoc_url=None, openapi_url=None)
STATIC = Path(__file__).resolve().parent / 'public'
# Di Vercel, public/ dipublikasikan melalui CDN dan sering tidak ikut masuk
# ke bundle Python Function. Mount hanya untuk pengembangan lokal.
assets_dir = STATIC / 'assets'
if not os.getenv('VERCEL') and assets_dir.is_dir():
    app.mount('/assets', StaticFiles(directory=str(assets_dir)), name='assets')
COOKIE = 'km_session'
KINDS = ('income','expense','transfer')

@app.middleware('http')
async def headers(request: Request, call_next):
    try:
        response = await call_next(request)
    except RuntimeError:
        return JSONResponse({'detail':'Konfigurasi server/database belum lengkap. Periksa DATABASE_URL dan secret.'},status_code=503)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    if request.url.path.startswith('/api/'):
        response.headers['Cache-Control'] = 'no-store, private'
    return response

@app.get('/', include_in_schema=False)
def index():
    # File public/index.html tidak selalu tersedia di fungsi serverless Vercel.
    # CDN Vercel otomatis menyajikan public/index.html sebagai /index.html.
    page = STATIC / 'index.html'
    if page.is_file():
        return FileResponse(page)
    return RedirectResponse(url='/index.html', status_code=307)

@app.get('/health', include_in_schema=False)
def health():
    return {'status':'ok', 'app':'Keuangan Mandiri', 'version':'2.1'}


@app.get('/health/db', include_in_schema=False)
def health_db():
    """Tes database tanpa membocorkan URI atau kredensial PostgreSQL."""
    from sqlalchemy import text
    try:
        Session = session_factory()
        with Session() as db:
            db.execute(text('SELECT 1')).scalar_one()
        return {'status':'ok', 'database':'connected'}
    except Exception:
        # Rincian teknis hanya tersedia di Vercel Runtime Logs.
        import logging
        logging.getLogger(__name__).exception('Database health check failed')
        return JSONResponse({'status':'error', 'database':'unavailable',
                             'hint':'Cek DATABASE_URL / Runtime Logs Vercel'}, status_code=503)


def today():
    return datetime.now(ZoneInfo('Asia/Jakarta')).date()


def fail(message, status=400):
    raise HTTPException(status_code=status, detail=message)


def config():
    secret = os.getenv('SESSION_SECRET','')
    password = os.getenv('APP_PASSWORD','')
    pw_hash = os.getenv('APP_PASSWORD_HASH','')
    if len(secret) < 32 or (not password and not pw_hash):
        raise RuntimeError('SESSION_SECRET (32+ chars) dan APP_PASSWORD/APP_PASSWORD_HASH wajib diatur')
    return secret, password, pw_hash


def signer():
    return URLSafeTimedSerializer(config()[0],salt='km-owner-session-v1')


def is_production():
    return os.getenv('VERCEL') == '1' or os.getenv('APP_ENV') == 'production'


def current_user(request: Request, write=False):
    raw = request.cookies.get(COOKIE)
    if not raw:
        fail('Silakan login terlebih dahulu.',401)
    try:
        session = signer().loads(raw,max_age=60*60*24*7)
    except (BadSignature,SignatureExpired):
        fail('Sesi habis, silakan login ulang.',401)
    if not isinstance(session,dict) or session.get('u') != 'owner':
        fail('Sesi tidak valid.',401)
    if write:
        provided = request.headers.get('x-csrf-token','')
        expected = session.get('csrf','')
        if not provided or not isinstance(expected,str) or not hmac.compare_digest(provided,expected):
            fail('Token keamanan tidak valid. Muat ulang halaman.',403)
        origin = request.headers.get('origin')
        if origin:
            from urllib.parse import urlsplit
            url = urlsplit(origin)
            if url.scheme != request.url.scheme or url.netloc != request.url.netloc:
                # trusted reverse proxy may have incoming scheme=http on Vercel;
                # compare Host and HTTPS production separately.
                host = request.headers.get('host','')
                if url.netloc != host or (is_production() and url.scheme != 'https'):
                    fail('Origin tidak diizinkan.',403)
    return session


def verify_password(given):
    _,plain,encoded = config()
    if encoded:
        try:
            algorithm,iterations,salt,hash_hex = encoded.split('$')
            if algorithm != 'pbkdf2_sha256' or not (100000 <= int(iterations) <= 2000000):
                return False
            derived = hashlib.pbkdf2_hmac('sha256',given.encode(),bytes.fromhex(salt),int(iterations)).hex()
            return hmac.compare_digest(derived,hash_hex)
        except (ValueError,TypeError):
            return False
    return hmac.compare_digest(given.encode(),plain.encode())


def row(m):
    from sqlalchemy import inspect
    def val(v):
        if isinstance(v,(date,datetime)):
            return v.isoformat()
        return v
    return {c.key:val(getattr(m,c.key)) for c in inspect(m).mapper.column_attrs}


def txt(data,key,max_len=180,required=False):
    value = str(data.get(key,'') or '').strip()
    if required and not value:
        fail(f'{key} wajib diisi.')
    if len(value)>max_len:
        fail(f'{key} terlalu panjang (maks {max_len} karakter).')
    return value


def integer(data,key,positive=True,allow_zero=False):
    value = data.get(key)
    if isinstance(value,bool) or value is None or not re.fullmatch(r'-?\d+',str(value)):
        fail(f'{key} harus berupa angka rupiah bulat.')
    num = int(value)
    if abs(num)>10**13:
        fail(f'{key} terlalu besar.')
    if positive and (num < 0 if allow_zero else num <=0):
        fail(f'{key} harus positif.')
    return num


def day(data,key,nullable=False):
    value = data.get(key)
    if nullable and not value:
        return None
    try:
        return date.fromisoformat(str(value))
    except (ValueError,TypeError):
        fail(f'{key} bukan tanggal YYYY-MM-DD yang valid.')


def month_field(value):
    value = str(value or today().strftime('%Y-%m'))
    if not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])',value):
        fail('Bulan harus YYYY-MM.')
    if not 2000<=int(value[:4])<=2100:
        fail('Tahun di luar batas.')
    return value


def get_one(db, cls, ident):
    try:
        pk = int(ident)
    except (TypeError,ValueError):
        fail('ID tidak valid.')
    value = db.get(cls,pk)
    if value is None:
        fail('Data tidak ditemukan.',404)
    return value


def account(db,ident):
    obj=get_one(db,Account,ident)
    if obj.archived:
        fail('Akun diarsipkan. Pilih akun aktif.')
    return obj


def category(db,ident,kind):
    obj=get_one(db,Category,ident)
    if obj.archived or obj.kind != kind:
        fail('Kategori tidak aktif atau tipenya tidak cocok.')
    return obj


def tx_fields(db,data):
    kind=txt(data,'kind',16,True)
    if kind not in KINDS:
        fail('Tipe transaksi tidak dikenal.')
    amount=integer(data,'amount')
    from_id=account(db,data.get('account_id')).id
    to_id=None
    cat_id=None
    if kind=='transfer':
        to_id=account(db,data.get('to_account_id')).id
        if to_id==from_id:
            fail('Akun asal dan tujuan harus berbeda.')
    else:
        cat_id=category(db,data.get('category_id'),kind).id
    return dict(tx_date=day(data,'tx_date'),kind=kind,amount=amount,account_id=from_id,
                to_account_id=to_id,category_id=cat_id,note=txt(data,'note',240))


def create_tx(db,data):
    t=Transaction(**tx_fields(db,data))
    db.add(t)
    db.flush()
    return t


def add_months(d,months):
    ym=d.year*12+d.month-1+months
    yy,mm=divmod(ym,12)
    mm+=1
    return date(yy,mm,min(d.day,calendar.monthrange(yy,mm)[1]))


def next_day(d,interval):
    if interval=='weekly':
        return d+timedelta(days=7)
    if interval=='monthly':
        return add_months(d,1)
    if interval=='yearly':
        return add_months(d,12)
    fail('Interval transaksi berulang tidak valid.')


@app.post('/api/auth/login')
async def login(request: Request):
    body=await request.json()
    supplied=str(body.get('password',''))
    name=str(body.get('username','')).strip()
    username=os.getenv('APP_USERNAME','owner')
    secret,_,_=config()
    addr = request.headers.get('x-real-ip') or (request.client.host if request.client else 'unknown')
    fingerprint=hmac.new(secret.encode(),str(addr).encode(),hashlib.sha256).hexdigest()
    now=datetime.now(timezone.utc).replace(tzinfo=None)
    Session=session_factory()
    refused=False
    with Session.begin() as db:
        attempts=db.query(LoginAttempt).filter(LoginAttempt.ip_hash==fingerprint,LoginAttempt.at>=now-timedelta(minutes=15)).count()
        if attempts>=8:
            fail('Terlalu banyak percobaan. Coba lagi dalam 15 menit.',429)
        valid_name=hmac.compare_digest(name.encode(),username.encode())
        valid_pass=verify_password(supplied)
        if not (valid_name and valid_pass):
            db.add(LoginAttempt(ip_hash=fingerprint))
            refused=True
        else:
            db.query(LoginAttempt).filter(LoginAttempt.ip_hash==fingerprint).delete(synchronize_session=False)
    if refused:
        fail('Username atau password salah.',401)
    csrf=secrets.token_urlsafe(32)
    cookie=signer().dumps({'u':'owner','csrf':csrf})
    response=JSONResponse({'ok':True,'username':username,'csrf':csrf})
    response.set_cookie(COOKIE,cookie,httponly=True,secure=is_production(),samesite='strict',max_age=604800,path='/')
    return response


@app.get('/api/auth/me')
def me(request:Request):
    s=current_user(request)
    return {'ok':True,'username':os.getenv('APP_USERNAME','owner'),'csrf':s['csrf']}


@app.post('/api/auth/logout')
def logout(request: Request):
    current_user(request,write=True)
    response=JSONResponse({'ok':True})
    response.delete_cookie(COOKIE,path='/',secure=is_production(),httponly=True,samesite='strict')
    return response


@app.get('/api/bootstrap')
def bootstrap(request:Request, month:str|None=None):
    current_user(request)
    m=month_field(month)
    first=date.fromisoformat(m+'-01')
    stop=add_months(first,1)
    Session=session_factory()
    with Session() as db:
        accounts=db.query(Account).order_by(Account.archived,Account.name).all()
        categories=db.query(Category).order_by(Category.kind,Category.name).all()
        recent=db.query(Transaction).filter(Transaction.tx_date>=first,Transaction.tx_date<stop).order_by(Transaction.tx_date.desc(),Transaction.id.desc()).limit(400).all()
        total_rows=db.query(func.count(Transaction.id)).filter(Transaction.tx_date>=first,Transaction.tx_date<stop).scalar() or 0
        months=[]
        for n in range(5,-1,-1):
            d=add_months(first,-n)
            boundary=add_months(d,1)
            sums=dict(db.query(Transaction.kind,func.coalesce(func.sum(Transaction.amount),0)).filter(
                Transaction.tx_date>=d,Transaction.tx_date<boundary,Transaction.kind.in_(['income','expense'])).group_by(Transaction.kind).all())
            months.append({'month':d.strftime('%Y-%m'),'income':int(sums.get('income',0)), 'expense':int(sums.get('expense',0))})
        month_sum=dict(db.query(Transaction.kind,func.coalesce(func.sum(Transaction.amount),0)).filter(
            Transaction.tx_date>=first,Transaction.tx_date<stop,Transaction.kind.in_(['income','expense'])).group_by(Transaction.kind).all())
        inflows=dict(db.query(Transaction.account_id,func.coalesce(func.sum(case((Transaction.kind=='income',Transaction.amount),else_=-Transaction.amount)),0)).group_by(Transaction.account_id).all())
        incoming=dict(db.query(Transaction.to_account_id,func.coalesce(func.sum(Transaction.amount),0)).filter(Transaction.kind=='transfer').group_by(Transaction.to_account_id).all())
        bycat=dict(db.query(Transaction.category_id,func.coalesce(func.sum(Transaction.amount),0)).filter(
            Transaction.tx_date>=first,Transaction.tx_date<stop,Transaction.kind=='expense').group_by(Transaction.category_id).all())
        budget=db.query(Budget).filter(Budget.month==m).all()
        goals=db.query(Goal).order_by(Goal.id.desc()).all()
        deposits=db.query(GoalDeposit.goal_id,func.coalesce(func.sum(GoalDeposit.amount),0)).group_by(GoalDeposit.goal_id).all()
        debts=db.query(Debt).order_by(Debt.id.desc()).all()
        paid=dict(db.query(DebtPayment.debt_id,func.coalesce(func.sum(DebtPayment.amount),0)).group_by(DebtPayment.debt_id).all())
        recurring=db.query(Recurring).order_by(Recurring.active.desc(),Recurring.next_date).all()
        return {'month':m,'accounts':[dict(row(a),balance=a.opening_balance+int(inflows.get(a.id,0))+int(incoming.get(a.id,0))) for a in accounts],
                'categories':[row(c) for c in categories], 'transactions':[row(t) for t in recent],
                'transaction_count':total_rows,'budgets':[dict(row(b),spent=int(bycat.get(b.category_id,0))) for b in budget],
                'goals':[dict(row(g),saved=int(dict(deposits).get(g.id,0))) for g in goals],
                'debts':[dict(row(d),paid=int(paid.get(d.id,0))) for d in debts], 'recurring':[row(r) for r in recurring],
                'expense_by_category':[{'category_id':c,'amount':int(total)} for c,total in bycat.items()],
                'summary':{'income':int(month_sum.get('income',0)),'expense':int(month_sum.get('expense',0)),'balance':sum(a.opening_balance+int(inflows.get(a.id,0))+int(incoming.get(a.id,0)) for a in accounts)},
                'trend':months,'server_date':today().isoformat()}


@app.post('/api/command')
async def command(request:Request):
    current_user(request,write=True)
    payload=await request.json()
    entity=str(payload.get('entity',''))
    action=str(payload.get('action','create'))
    data=payload.get('data') or {}
    if not isinstance(data,dict):
        fail('Format data tidak valid.')
    if entity not in ('account','category','transaction','budget','goal','goal_deposit','debt','debt_payment','recurring'):
        fail('Entitas tidak dikenal.')
    if action not in ('create','update','delete'):
        fail('Perintah tidak dikenal.')
    if entity in ('goal_deposit','debt_payment') and action!='create':
        fail('Catatan pembayaran/setoran hanya bisa dibuat dari menu ini.')
    Session=session_factory()
    try:
        with Session.begin() as db:
            cls={'account':Account,'category':Category,'transaction':Transaction,'budget':Budget,'goal':Goal,
                 'debt':Debt,'recurring':Recurring}.get(entity)
            obj=get_one(db,cls,data.get('id')) if action!='create' else None
            if action=='delete':
                if entity in ('account','category'):
                    obj.archived=True
                elif entity=='transaction':
                    if obj.payment_id is not None:
                        fail('Transaksi pembayaran hutang/piutang tidak bisa dihapus terpisah.')
                    db.delete(obj)
                elif entity=='goal':
                    db.query(GoalDeposit).filter(GoalDeposit.goal_id==obj.id).delete()
                    db.delete(obj)
                elif entity=='debt':
                    payments=db.query(DebtPayment).filter(DebtPayment.debt_id==obj.id).all()
                    for p in payments:
                        if p.transaction_id:
                            t=db.get(Transaction,p.transaction_id)
                            if t:
                                db.delete(t)
                        db.delete(p)
                    db.delete(obj)
                else:
                    db.delete(obj)
                return {'ok':True}
            if entity=='account':
                name=txt(data,'name',90,True)
                kind=txt(data,'kind',25,True)
                if kind not in ('cash','bank','ewallet','savings','other'):
                    fail('Jenis akun tidak valid.')
                if action=='create':
                    db.add(Account(name=name,kind=kind,opening_balance=integer(data,'opening_balance',positive=False)))
                else:
                    obj.name=name; obj.kind=kind
                    if 'opening_balance' in data:
                        obj.opening_balance=integer(data,'opening_balance',positive=False)
                    if 'archived' in data:
                        obj.archived=bool(data['archived'])
            elif entity=='category':
                name=txt(data,'name',70,True)
                kind=txt(data,'kind',10,True)
                if kind not in ('income','expense'):
                    fail('Jenis kategori tidak valid.')
                if action=='create':
                    db.add(Category(name=name,kind=kind))
                else:
                    if obj.kind!=kind:
                        fail('Jenis kategori lama tidak boleh diubah.')
                    obj.name=name
                    if 'archived' in data:
                        obj.archived=bool(data['archived'])
            elif entity=='transaction':
                fields=tx_fields(db,data)
                if action=='create':
                    db.add(Transaction(**fields))
                else:
                    if obj.payment_id is not None:
                        fail('Transaksi hasil pembayaran hutang/piutang tidak boleh diubah.')
                    for key,value in fields.items():
                        setattr(obj,key,value)
            elif entity=='budget':
                c=category(db,data.get('category_id'),'expense')
                values=dict(category_id=c.id,month=month_field(data.get('month')),amount=integer(data,'amount'))
                if action=='create':
                    db.add(Budget(**values))
                else:
                    for k,v in values.items():setattr(obj,k,v)
            elif entity=='goal':
                values=dict(name=txt(data,'name',100,True),target=integer(data,'target'))
                if action=='create':db.add(Goal(**values))
                else:
                    for k,v in values.items():setattr(obj,k,v)
            elif entity=='goal_deposit':
                g=get_one(db,Goal,data.get('goal_id'))
                db.add(GoalDeposit(goal_id=g.id,amount=integer(data,'amount'),deposit_date=day(data,'deposit_date'),note=txt(data,'note',240)))
            elif entity=='debt':
                kind=txt(data,'kind',12,True)
                if kind not in ('debt','receivable'):
                    fail('Jenis hutang/piutang tidak valid.')
                amount=integer(data,'amount')
                values=dict(kind=kind,person=txt(data,'person',110,True),amount=amount,
                            due_date=day(data,'due_date',True),note=txt(data,'note',240))
                if action=='create':db.add(Debt(**values))
                else:
                    total=db.query(func.coalesce(func.sum(DebtPayment.amount),0)).filter(DebtPayment.debt_id==obj.id).scalar()
                    if amount < total:
                        fail('Total hutang/piutang tidak boleh lebih kecil dari yang telah dibayar.')
                    if kind!=obj.kind and total:
                        fail('Jenis tidak boleh berubah setelah ada pembayaran.')
                    for k,v in values.items():setattr(obj,k,v)
            elif entity=='debt_payment':
                d=get_one(db,Debt,data.get('debt_id'))
                a=account(db,data.get('account_id'))
                amount=integer(data,'amount')
                already=db.query(func.coalesce(func.sum(DebtPayment.amount),0)).filter(DebtPayment.debt_id==d.id).scalar()
                if already+amount>d.amount:
                    fail('Pembayaran melebihi sisa hutang/piutang.')
                paid_date=day(data,'paid_date')
                p=DebtPayment(debt_id=d.id,account_id=a.id,amount=amount,paid_date=paid_date)
                db.add(p); db.flush()
                kind='expense' if d.kind=='debt' else 'income'
                # Payments appear in cashflow without being double-counted as manual transactions.
                t=Transaction(tx_date=paid_date,kind=kind,amount=amount,account_id=a.id,
                              note=('Bayar hutang: ' if kind=='expense' else 'Terima piutang: ')+d.person,
                              payment_id=p.id)
                db.add(t); db.flush(); p.transaction_id=t.id
            elif entity=='recurring':
                fields=tx_fields(db,dict(data,tx_date=data.get('next_date')))
                interval=txt(data,'interval',10,True)
                if interval not in ('weekly','monthly','yearly'):
                    fail('Interval harus mingguan, bulanan, atau tahunan.')
                values={k:v for k,v in fields.items() if k!='tx_date'}
                values.update(next_date=day(data,'next_date'),interval=interval,active=bool(data.get('active',True)))
                if action=='create':db.add(Recurring(**values))
                else:
                    for k,v in values.items():setattr(obj,k,v)
            db.flush()
            return {'ok':True}
    except IntegrityError:
        fail('Data duplikat, sedang dipakai, atau melanggar aturan database. Cek kembali isian.',409)


@app.post('/api/recurring/process')
def process_recurring(request:Request):
    current_user(request,write=True)
    Session=session_factory()
    count=0
    with Session.begin() as db:
        jobs=db.query(Recurring).filter(Recurring.active.is_(True),Recurring.next_date<=today()).order_by(Recurring.id).with_for_update(skip_locked=True).all()
        for r in jobs:
            processed=0
            while r.next_date<=today() and processed<24:
                exists=db.query(Transaction.id).filter(Transaction.recurring_id==r.id,Transaction.tx_date==r.next_date).first()
                if not exists:
                    db.add(Transaction(tx_date=r.next_date,kind=r.kind,amount=r.amount,
                                       account_id=r.account_id,to_account_id=r.to_account_id,
                                       category_id=r.category_id,note=r.note,recurring_id=r.id))
                    count+=1
                r.next_date=next_day(r.next_date,r.interval)
                processed+=1
    return {'ok':True,'processed':count}


@app.get('/api/backup')
def backup(request:Request):
    current_user(request)
    Session=session_factory()
    tables=[Account,Category,Transaction,Budget,Goal,GoalDeposit,Debt,DebtPayment,Recurring]
    with Session() as db:
        content={'format':'keuangan-mandiri-neon-v1','generated_at':datetime.now(timezone.utc).isoformat(),
                 'tables':{m.__tablename__:[row(x) for x in db.query(m).all()] for m in tables}}
        response=JSONResponse(content)
        response.headers['Content-Disposition']='attachment; filename="keuangan-mandiri-backup.json"'
        return response
