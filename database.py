import os
import threading
from sqlalchemy import create_engine
from sqlalchemy.pool import NullPool
from sqlalchemy.orm import sessionmaker
from models import Base, Account, Category

_engine = None
_sessionmaker = None
_ready = False
_guard = threading.Lock()

DEFAULT_CATEGORIES = [
 ('Gaji','income'),('Bonus','income'),('Usaha','income'),('Hadiah','income'),('Lainnya','income'),
 ('Makan & Minum','expense'),('Transportasi','expense'),('Belanja','expense'),('Tagihan','expense'),
 ('Kesehatan','expense'),('Pendidikan','expense'),('Hiburan','expense'),('Keluarga','expense'),('Lainnya','expense')
]

def session_factory():
    global _engine, _sessionmaker, _ready
    if _sessionmaker is None:
        with _guard:
            if _sessionmaker is None:
                url = os.getenv('DATABASE_URL', '').strip()
                if not url:
                    raise RuntimeError('DATABASE_URL belum disetel di Vercel Environment Variables.')
                if url.startswith('postgres://'):
                    url = 'postgresql://' + url[len('postgres://'):]
                if url.startswith('postgresql://'):
                    url = 'postgresql+psycopg://' + url[len('postgresql://'):]
                if (os.getenv('VERCEL') or os.getenv('APP_ENV') == 'production') and url.startswith('sqlite'):
                    raise RuntimeError('SQLite tidak boleh digunakan di Vercel. Pakai Neon DATABASE_URL.')
                _engine = create_engine(url, poolclass=NullPool, pool_pre_ping=True, connect_args={'connect_timeout': 8} if 'postgresql' in url else {})
                _sessionmaker = sessionmaker(bind=_engine, expire_on_commit=False)
    if not _ready:
        with _guard:
            if not _ready:
                Base.metadata.create_all(bind=_engine)
                with _sessionmaker.begin() as db:
                    if db.query(Account.id).first() is None:
                        db.add(Account(name='Tunai', kind='cash', opening_balance=0))
                    if db.query(Category.id).first() is None:
                        db.add_all(Category(name=n,kind=k) for n,k in DEFAULT_CATEGORIES)
                _ready = True
    return _sessionmaker
