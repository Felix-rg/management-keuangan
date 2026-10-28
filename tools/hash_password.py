"""Optional PBKDF2 password hash. Run: python tools/hash_password.py"""
import getpass
import hashlib
import secrets

password = getpass.getpass('Masukkan password login yang ingin di-hash: ')
if len(password) < 12:
    raise SystemExit('Gunakan password unik minimal 12 karakter.')
salt = secrets.token_bytes(20)
iters = 350_000
derived = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, iters).hex()
print('Set APP_PASSWORD_HASH di Vercel, hapus APP_PASSWORD:')
print(f'pbkdf2_sha256${iters}${salt.hex()}${derived}')
