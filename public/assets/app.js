/* Keuangan Mandiri. Pure browser JS, no npm, no external CDN, no spreadsheet. */
'use strict';
const $ = s => document.querySelector(s);
const fmt = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const jakarta = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const initialMonth = () => jakarta().slice(0,7);
const dateLabel = s => s ? new Date(s + 'T12:00:00').toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'}) : '—';
const pct = (a,b) => b > 0 ? Math.max(0, Math.round(a / b * 100)) : 0;
const st = { user:'owner', csrf:'', data:null, section:'dashboard', month:initialMonth(), modal:null, filter:'' };
const navNames = {dashboard:'Ringkasan',transactions:'Transaksi',accounts:'Akun & Saldo',categories:'Kategori',budgets:'Anggaran',goals:'Target Keuangan',debts:'Hutang & Piutang',recurring:'Berulang',reports:'Laporan',settings:'Pengaturan'};
let toastTimer;

async function api(path, options={}) {
  const headers = {'Accept':'application/json', ...(options.body ? {'Content-Type':'application/json'} : {}), ...options.headers};
  if (options.method && options.method.toUpperCase() !== 'GET' && st.csrf) headers['X-CSRF-Token'] = st.csrf;
  const res = await fetch('/api'+path, {...options, headers,credentials:'same-origin', cache:'no-store'});
  let data;
  try { data = await res.json(); } catch (_) { throw new Error('Respons server tidak valid. Periksa log Vercel.'); }
  if (!res.ok) {
    if (res.status===401 && !path.startsWith('/auth/')) showAuth();
    throw new Error(typeof data.detail === 'string' ? data.detail : 'Gagal menghubungi server.');
  }
  return data;
}
function toast(message) { const t=$('#toast'); t.textContent=message;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),3700); }
function showAuth(){ st.csrf='';st.data=null;$('#mobile-drawer').classList.add('hidden');$('#auth-screen').classList.remove('hidden');$('#workspace').classList.add('hidden'); }
function showWork(){ $('#auth-screen').classList.add('hidden');$('#workspace').classList.remove('hidden');$('#side-username').textContent=st.user; }
async function enter(){
  showWork(); $('#month-picker').value=st.month;
  try { await api('/recurring/process',{method:'POST'}); } catch(e) { toast('Berulang: '+e.message); }
  await load();
}
async function load(){
  $('#content').innerHTML='<div class="panel"><p class="muted"><span class="spin">↻</span> Mengambil data dari Neon...</p></div>';
  try { st.data=await api('/bootstrap?month='+encodeURIComponent(st.month)); render(); }
  catch(e){ $('#content').innerHTML=`<div class="panel"><h2>Gagal memuat data</h2><p class="muted">${esc(e.message)}</p><button class="btn primary" id="retry-load">Coba ulang</button></div>`; }
}
const d = () => st.data || {accounts:[],categories:[],transactions:[],budgets:[],goals:[],debts:[],recurring:[],expense_by_category:[],summary:{income:0,expense:0,balance:0},trend:[]};
const find = (type,id) => d()[type]?.find(x=>Number(x.id)===Number(id));
const acct = id => find('accounts',id)?.name || 'Akun tidak dikenal';
const cat = id => find('categories',id)?.name || 'Tanpa kategori';
const titleBlock = (title,sub,kicker='KEUANGAN MANDIRI',button='') => `<div class="page-header"><div><p class="kicker">${esc(kicker)}</p><h1>${esc(title)}</h1><p class="subtitle">${esc(sub)}</p></div>${button?`<div class="actions">${button}</div>`:''}</div>`;
const addBtn = (entity,text='Tambah baru') => `<button class="btn primary" data-new="${entity}">＋ ${esc(text)}</button>`;
const panelTitle = (title,button='') => `<div class="panel-head"><h2>${esc(title)}</h2>${button}</div>`;
const empty = (title,detail='Klik tambah untuk mulai mencatat.') => `<div class="empty"><div class="empty-symbol">◌</div><strong>${esc(title)}</strong>${esc(detail)}</div>`;
const smallAct = (entity,id) => `<div class="row-actions"><button data-edit="${entity}:${Number(id)}" title="Edit">Edit</button><button data-delete="${entity}:${Number(id)}" title="Hapus atau arsipkan">✕</button></div>`;
const badge = (type) => `<span class="badge ${esc(type)}">${{income:'Pemasukan',expense:'Pengeluaran',transfer:'Transfer'}[type]||esc(type)}</span>`;
const numClass = kind => kind==='income'?'amount-pos':kind==='expense'?'amount-neg':'amount-neutral';
const moneySigned = t => (t.kind==='income'?'+':t.kind==='expense'?'-':'')+fmt(t.amount);
const kindTitle = kind => ({cash:'Tunai',bank:'Bank',ewallet:'E-Wallet',savings:'Tabungan',other:'Lainnya'}[kind]||kind);
const safeProgress = (a,b) => `<div class="progress-track"><div class="progress-fill ${pct(a,b)>=100?'over':pct(a,b)>=80?'warning':''}" style="width:${Math.min(100,pct(a,b))}%"></div></div>`;

function render(){
  for(const b of document.querySelectorAll('[data-section]'))b.classList.toggle('active',b.dataset.section===st.section);
  $('#breadcrumb-label').textContent=navNames[st.section];
  const pages={dashboard:dashboard,transactions:transactions,accounts:accounts,categories:categories,budgets:budgets,goals:goals,debts:debts,recurring:recurring,reports:reports,settings:settings};
  $('#content').innerHTML=pages[st.section]();
}
function chart(){
  const trends=d().trend;
  const max=Math.max(1,...trends.flatMap(r=>[r.income,r.expense]));
  return `<div class="trend-chart">${trends.map(r=>`<div class="chart-col"><div class="bar-pair"><div title="Pemasukan ${esc(r.month)}: ${fmt(r.income)}" class="bar" style="--height:${Math.max(1,Math.round(r.income/max*100))}%"></div><div title="Pengeluaran ${esc(r.month)}: ${fmt(r.expense)}" class="bar expense" style="--height:${Math.max(1,Math.round(r.expense/max*100))}%"></div></div><span class="chart-label">${esc(new Date(r.month+'-01T12:00:00').toLocaleDateString('id-ID',{month:'short'}))}</span></div>`).join('')}</div><div class="legend"><span><i></i>Pemasukan</span><span><i class="lg-expense"></i>Pengeluaran</span></div>`;
}
function breakdown(){
  const items=[...d().expense_by_category].sort((a,b)=>b.amount-a.amount).slice(0,6);
  if(!items.length)return empty('Belum ada pengeluaran','Grafik kategori muncul setelah transaksi pertama.');
  const total=d().summary.expense||1;
  return items.map(r=>`<div class="stack-item"><div class="stack-row"><span>${esc(cat(r.category_id))}</span><b>${fmt(r.amount)}</b></div><div class="subtle">${pct(r.amount,total)}% dari total pengeluaran</div>${safeProgress(r.amount,total)}</div>`).join('');
}
function metric(tag,val,detail,icon='',cls=''){
  return `<div class="metric ${cls}"><div class="metric-tag"><span class="circle">${icon}</span>${esc(tag)}</div><div class="metric-amount" title="${fmt(val)}">${fmt(val)}</div><div class="metric-detail">${esc(detail)}</div></div>`;
}
function dashboard(){
  const x=d(),s=x.summary,net=s.income-s.expense;
  const top=titleBlock('Uangmu, lebih terarah.',`Ringkasan kondisi keuangan ${monthLong(st.month)}.`, 'DASHBOARD / OVERVIEW',addBtn('transaction','Catat transaksi'));
  const accountsOpen=x.accounts.filter(a=>!a.archived);
  return top+`<div class="metrics">${metric('Total Saldo',s.balance,`${accountsOpen.length} akun tersambung`,'▣','dark')}${metric('Pemasukan',s.income,'Total masuk bulan ini','↗')}${metric('Pengeluaran',s.expense,'Total keluar bulan ini','↘')}${metric('Arus Kas Bersih',net,net>=0?'Pemasukan melebihi pengeluaran':'Pengeluaran melebihi pemasukan','⇌')}</div>
  <div class="grid-2"><section class="panel">${panelTitle('Arus kas 6 bulan','<span class="subtle">Pemasukan vs pengeluaran</span>')}${chart()}</section><section class="panel">${panelTitle('Pengeluaran terbesar')}${breakdown()}</section></div>
  <div class="grid-2"><section class="panel">${panelTitle('Transaksi terbaru',`<button data-section="transactions" class="link-button">Lihat semua →</button>`)}${tableTransactions(x.transactions.slice(0,6),false)}</section><section class="panel">${panelTitle('Akun & saldo',`<button data-section="accounts" class="link-button">Kelola →</button>`)}${accountsOpen.length?accountsOpen.map(a=>`<div class="summary-strip"><span>${esc(a.name)}<small class="muted"> · ${esc(kindTitle(a.kind))}</small></span><b>${fmt(a.balance)}</b></div>`).join(''):empty('Belum ada akun')}</section></div>`;
}
function tableTransactions(items, editable=true){
 if(!items.length)return empty('Belum ada transaksi di bulan ini');
 return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Transaksi</th><th>Tanggal</th><th>Jenis</th><th>Nominal</th>${editable?'<th></th>':''}</tr></thead><tbody>${items.map(t=>`<tr><td><div class="record-name">${esc(t.payment_id?t.note:(t.kind==='transfer'?'Transfer '+acct(t.account_id)+' → '+acct(t.to_account_id):cat(t.category_id)))}</div><div class="record-note">${esc(t.payment_id?acct(t.account_id):(t.note||acct(t.account_id)))}${t.payment_id?' · pembayaran hutang/piutang':''}</div></td><td class="subtle">${dateLabel(t.tx_date)}</td><td>${badge(t.kind)}</td><td class="${numClass(t.kind)}">${esc(moneySigned(t))}</td>${editable?`<td>${t.payment_id?'<span class="subtle">Terkunci</span>':smallAct('transaction',t.id)}</td>`:''}</tr>`).join('')}</tbody></table></div>`;
}
function transactions(){
 const list=d().transactions.filter(t=>[t.note,cat(t.category_id),acct(t.account_id),String(t.amount)].join(' ').toLowerCase().includes(st.filter.toLowerCase()));
 return titleBlock('Daftar transaksi',`Riwayat ${monthLong(st.month)}. Menampilkan ${d().transactions.length} dari ${d().transaction_count} transaksi bulan ini.`,'TRANSAKSI',addBtn('transaction','Transaksi baru'))+
 `<div class="panel"><div class="search-row"><input class="search-input" id="filter-transaction" type="search" placeholder="Cari catatan, kategori, nominal..." value="${esc(st.filter)}"><div class="subtle">Maksimal 400 transaksi terbaru per bulan</div></div><div id="transaction-table">${tableTransactions(list)}</div></div>`;
}
function accounts(){
 const list=d().accounts;
 return titleBlock('Akun & saldo','Kelola kas tunai, rekening, e-wallet, dan tabungan.','REKENING / WALLET',addBtn('account','Tambah akun'))+
 `<div class="info-box">Saldo dihitung otomatis: saldo awal + pemasukan - pengeluaran ± transfer. Mengarsipkan akun tidak menghapus riwayatnya.</div><div class="card-grid">${list.map(a=>`<div class="small-card"><div class="icon-box">▣</div><h3>${esc(a.name)} ${a.archived?'<span class="badge">Arsip</span>':''}</h3><div class="meta">${esc(kindTitle(a.kind))} · Saldo awal ${fmt(a.opening_balance)}</div><div class="big">${fmt(a.balance)}</div><div class="actions-bottom"><button class="btn ghost sm" data-edit="account:${a.id}">Edit ${a.archived?' / Aktifkan':''}</button><button class="btn ${a.archived?'ghost':'danger'} sm" data-delete="account:${a.id}">${a.archived?'Arsip':'Arsipkan'}</button></div></div>`).join('')}</div>`;
}
function categories(){
 const cs=d().categories;
 return titleBlock('Kategori transaksi','Atur jenis pemasukan dan pengeluaran.','KATEGORI',addBtn('category','Buat kategori'))+
 `<div class="grid-2">${['income','expense'].map(k=>`<div class="panel">${panelTitle(k==='income'?'Kategori pemasukan':'Kategori pengeluaran')}${cs.filter(c=>c.kind===k).map(c=>`<div class="summary-strip"><div>${esc(c.name)} ${c.archived?'<span class="badge">Arsip</span>':''}</div>${smallAct('category',c.id)}</div>`).join('')||empty('Kosong')}</div>`).join('')}</div>`;
}
function budgets(){
 const list=d().budgets;
 const expense=d().summary.expense;
 return titleBlock('Kontrol anggaran',`Batas belanja kategori untuk ${monthLong(st.month)}.`,'BUDGET BULANAN',addBtn('budget','Tambah budget'))+
 `<div class="info-box">Budget mengikuti bulan yang dipilih di bagian atas. Persentase pengeluaran dihitung dari transaksi aktual pada kategori tersebut.</div><div class="card-grid">${list.length?list.map(b=>`<div class="small-card"><div class="stack-row"><strong>${esc(cat(b.category_id))}</strong><span class="badge ${b.spent>b.amount?'expense':'income'}">${pct(b.spent,b.amount)}%</span></div><div class="big">${fmt(b.spent)}</div><div class="meta">Dari batas ${fmt(b.amount)}</div>${safeProgress(b.spent,b.amount)}<div class="meta">Sisa anggaran: ${fmt(b.amount-b.spent)}</div><div class="actions-bottom">${smallAct('budget',b.id)}</div></div>`).join(''):empty('Belum ada budget','Buat batas pengeluaran untuk kategori pilihan.')}</div><div class="panel" style="margin-top:18px"><div class="summary-strip"><span>Jumlah pengeluaran seluruh kategori</span><b>${fmt(expense)}</b></div><div class="summary-strip"><span>Total anggaran yang diset</span><b>${fmt(list.reduce((n,b)=>n+b.amount,0))}</b></div></div>`;
}
function goals(){
 return titleBlock('Target keuangan','Rencanakan tabungan dan pantau progres setoran.','SAVING GOALS',addBtn('goal','Target baru'))+
 `<div class="info-box">Setoran target hanya mencatat progres tujuan, tidak memotong saldo akun. Catat transfer ke tabungan secara terpisah bila uang benar-benar dipindahkan.</div><div class="card-grid">${d().goals.length?d().goals.map(g=>`<div class="small-card"><div class="icon-box">◎</div><h3>${esc(g.name)}</h3><div class="meta">Terkumpul</div><div class="big">${fmt(g.saved)}</div><div class="stack-row"><span class="meta">Target ${fmt(g.target)}</span><b>${pct(g.saved,g.target)}%</b></div>${safeProgress(g.saved,g.target)}<div class="actions-bottom"><button class="btn light sm" data-deposit="${g.id}">+ Setoran</button><button class="btn ghost sm" data-edit="goal:${g.id}">Edit</button><button class="btn danger sm" data-delete="goal:${g.id}">✕</button></div></div>`).join(''):empty('Belum ada target','Bikin tujuan baru, misalnya dana darurat.')}</div>`;
}
function debts(){
 const list=d().debts;
 const owing=list.filter(x=>x.kind==='debt').reduce((s,x)=>s+Math.max(0,x.amount-x.paid),0);
 const receivable=list.filter(x=>x.kind==='receivable').reduce((s,x)=>s+Math.max(0,x.amount-x.paid),0);
 return titleBlock('Hutang & piutang','Pantau siapa harus bayar, dan siapa yang harus dibayar.','KEWAJIBAN',addBtn('debt','Tambah catatan'))+
 `<div class="metrics">${metric('Sisa hutang',owing,'Yang perlu kamu bayar','↘')}${metric('Sisa piutang',receivable,'Yang perlu kamu terima','↗')}</div><div class="info-box">Mencatat hutang/piutang tidak otomatis mengubah saldo. Saat mencatat pembayarannya, saldo akun dan riwayat transaksi berubah otomatis.</div><div class="card-grid">${list.length?list.map(x=>`<div class="small-card"><div class="stack-row"><span class="badge ${x.kind==='debt'?'expense':'income'}">${x.kind==='debt'?'Hutang':'Piutang'}</span><span class="subtle">${x.due_date?'Tenggat '+dateLabel(x.due_date):'Tanpa tenggat'}</span></div><h3>${esc(x.person)}</h3><div class="big">${fmt(x.amount-x.paid)}</div><div class="meta">Sisa dari ${fmt(x.amount)} · Terbayar ${fmt(x.paid)}</div>${safeProgress(x.paid,x.amount)}${x.note?`<p class="subtle">${esc(x.note)}</p>`:''}<div class="actions-bottom">${x.amount>x.paid?`<button class="btn light sm" data-pay="${x.id}">+ Pembayaran</button>`:''}<button class="btn ghost sm" data-edit="debt:${x.id}">Edit</button><button class="btn danger sm" data-delete="debt:${x.id}">✕</button></div></div>`).join(''):empty('Belum ada hutang atau piutang')}</div>`;
}
function recurring(){
 return titleBlock('Transaksi berulang','Buat transaksi rutin otomatis ketika aplikasi dibuka.','RECURRING',`${addBtn('recurring','Jadwal baru')}<button class="btn ghost" id="process-recurring">↻ Proses sekarang</button>`)+
 `<div class="info-box warning-box">Jadwal diproses saat kamu membuka dan login ke aplikasi atau menekan "Proses sekarang". Tidak berjalan setiap hari ketika aplikasi tidak diakses. Maksimal 24 kejadian tertunda per jadwal setiap pemrosesan.</div><div class="panel">${d().recurring.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Transaksi</th><th>Jumlah</th><th>Interval</th><th>Berikutnya</th><th>Status</th><th></th></tr></thead><tbody>${d().recurring.map(r=>`<tr><td><div class="record-name">${esc(r.note||cat(r.category_id))}</div><div class="record-note">${esc(acct(r.account_id))}</div></td><td class="${numClass(r.kind)}">${fmt(r.amount)}</td><td>${({weekly:'Mingguan',monthly:'Bulanan',yearly:'Tahunan'}[r.interval]||'')}</td><td>${dateLabel(r.next_date)}</td><td><span class="badge ${r.active?'income':''}">${r.active?'Aktif':'Nonaktif'}</span></td><td>${smallAct('recurring',r.id)}</td></tr>`).join('')}</tbody></table></div>`:empty('Belum ada jadwal berulang')}</div>`;
}
function reports(){
 const x=d(),s=x.summary,net=s.income-s.expense;
 const rate=s.income>0?Math.round(net/s.income*100):0;
 return titleBlock('Laporan keuangan',`Rangkuman arus kas ${monthLong(st.month)}.`,'FINANCIAL REPORT')+
 `<div class="metrics">${metric('Pemasukan',s.income,'Bulan laporan','↗')}${metric('Pengeluaran',s.expense,'Bulan laporan','↘')}${metric('Net cashflow',net,'Pemasukan − pengeluaran','⇌')}${metric('Saldo keseluruhan',s.balance,'Semua akun','▣')}</div><div class="grid-2"><div class="panel">${panelTitle('Tren enam bulan')}${chart()}</div><div class="panel">${panelTitle('Ringkasan laporan')}<div class="summary-strip"><span>Jumlah transaksi bulan ini</span><b>${x.transaction_count}</b></div><div class="summary-strip"><span>Cashflow bersih</span><b class="${net>=0?'amount-pos':'amount-neg'}">${fmt(net)}</b></div><div class="summary-strip"><span>Rasio sisa pemasukan</span><b>${rate}%</b></div><div class="summary-strip"><span>Kategori pengeluaran aktif</span><b>${x.expense_by_category.filter(c=>c.category_id).length}</b></div></div></div><section class="panel">${panelTitle('Rincian pengeluaran per kategori')}${breakdown()}</section>`;
}
function settings(){
 return titleBlock('Pengaturan','Kelola keamanan dan cadangan data pribadi.','SETTINGS')+
 `<div class="panel narrow"><h2>Data & keamanan</h2><p class="muted">Semua catatan ada di database Neon PostgreSQL. Kode GitHub tidak berisi password atau koneksi database.</p><div class="summary-strip"><div><b>Cadangan JSON</b><div class="subtle">Unduh seluruh isi database tanpa Excel/Spreadsheet.</div></div><button class="btn ghost sm" id="download-backup">Unduh backup</button></div><div class="summary-strip"><div><b>Keamanan akun</b><div class="subtle">Ganti APP_PASSWORD melalui Environment Variables Vercel.</div></div><span class="badge income">Login aktif</span></div><div class="summary-strip"><div><b>Keluar dari akun</b><div class="subtle">Hapus sesi login pada perangkat ini.</div></div><button class="btn danger sm" id="logout">Logout</button></div></div><div class="info-box warning-box" style="margin-top:20px">Penting: file backup JSON berisi riwayat keuangan pribadi. Simpan secara aman. Backup belum memiliki tombol restore otomatis. Hindari mengunggahnya ke GitHub publik.</div>`;
}
function monthLong(m){ return new Date(m+'-01T12:00:00').toLocaleDateString('id-ID',{month:'long',year:'numeric'}); }

function input(name,label,type,value='',attrs=''){
 return `<div class="field"><label for="f-${esc(name)}">${esc(label)}</label><input id="f-${esc(name)}" name="${esc(name)}" type="${type}" ${attrs} value="${esc(value??'')}"></div>`;
}
function select(name,label,choices,value='',attrs=''){
 return `<div class="field"><label for="f-${esc(name)}">${esc(label)}</label><select name="${esc(name)}" id="f-${esc(name)}" ${attrs}>${choices.map(([v,l])=>`<option value="${esc(v)}" ${String(v)===String(value)?'selected':''}>${esc(l)}</option>`).join('')}</select></div>`;
}
function textArea(name,label,value=''){
 return `<div class="field"><label for="f-${esc(name)}">${esc(label)}</label><textarea id="f-${esc(name)}" name="${esc(name)}" maxlength="240">${esc(value)}</textarea></div>`;
}
const amountInput=(name,label,value=0,allowZero=false) => input(name,label,'number',value,`step="1" min="${allowZero?0:1}" max="10000000000000" required`);
const dateInput=(name,label,value)=>input(name,label,'date',value||jakarta(),'required');
const accountOpts=()=>d().accounts.filter(x=>!x.archived).map(a=>[a.id,a.name]);
const categoryOpts=(kind)=>d().categories.filter(c=>!c.archived&&c.kind===kind).map(c=>[c.id,c.name]);
const selectAccount=(name,value,label='Akun')=>select(name,label,accountOpts(),value,'required');
const selectCat=(name,kind,value)=>select(name,'Kategori',categoryOpts(kind),value,'required');

function fields(entity,obj={}){
 const o=obj;
 if (entity==='transaction' || entity==='recurring') {
  const kind=o.kind||'expense';
  const catType=kind==='income'?'income':'expense';
  const html=`${select('kind','Jenis transaksi',[['expense','Pengeluaran'],['income','Pemasukan'],['transfer','Transfer antar akun']],kind,'required')}
  ${amountInput('amount','Nominal (Rp)',o.amount||'')}
  ${selectAccount('account_id',o.account_id,'Akun asal / digunakan')}
  <div id="extra-transfer" ${kind!=='transfer'?'hidden':''}>${selectAccount('to_account_id',o.to_account_id,'Akun tujuan')}</div>
  <div id="extra-category" ${kind==='transfer'?'hidden':''}>${selectCat('category_id',catType,o.category_id)}</div>
  ${entity==='transaction'?dateInput('tx_date','Tanggal',o.tx_date):`${select('interval','Frekuensi',[['weekly','Mingguan'],['monthly','Bulanan'],['yearly','Tahunan']],o.interval||'monthly')}${dateInput('next_date','Jalankan mulai',o.next_date)}${select('active','Status',[['true','Aktif'],['false','Nonaktif']],String(o.active??true))}`}
  ${textArea('note','Catatan',o.note)}`;
  return html;
 }
 if(entity==='account')return `${input('name','Nama akun','text',o.name,'required maxlength="90"')}${select('kind','Jenis akun',[['cash','Tunai'],['bank','Bank'],['ewallet','E-wallet'],['savings','Tabungan'],['other','Lainnya']],o.kind||'cash')}${input('opening_balance','Saldo awal (Rp)','number',o.opening_balance??0,'step="1" required')}${o.archived?select('archived','Status arsip',[['true','Diarsipkan'],['false','Aktifkan kembali']],'true'):''}`;
 if(entity==='category')return `${input('name','Nama kategori','text',o.name,'required maxlength="70"')}${select('kind','Jenis kategori',[['expense','Pengeluaran'],['income','Pemasukan']],o.kind||'expense',o.id?'disabled':'')}${o.archived?select('archived','Status arsip',[['true','Diarsipkan'],['false','Aktifkan kembali']],'true'):''}`;
 if(entity==='budget')return `${selectCat('category_id','expense',o.category_id)}${input('month','Bulan','month',o.month||st.month,'required')}${amountInput('amount','Batas budget (Rp)',o.amount||'')}`;
 if(entity==='goal')return `${input('name','Nama target','text',o.name,'required maxlength="100"')}${amountInput('target','Target nominal (Rp)',o.target||'')}`;
 if(entity==='goal_deposit')return `${select('goal_id','Target',d().goals.map(g=>[g.id,g.name]),o.goal_id)}${amountInput('amount','Setoran (Rp)','')}${dateInput('deposit_date','Tanggal')}${textArea('note','Catatan')}`;
 if(entity==='debt')return `${select('kind','Jenis',[['debt','Hutang (harus dibayar)'],['receivable','Piutang (harus diterima)']],o.kind||'debt')}${input('person','Nama orang / pihak','text',o.person,'required maxlength="110"')}${amountInput('amount','Total nilai (Rp)',o.amount||'')}${input('due_date','Tanggal jatuh tempo (opsional)','date',o.due_date||'')}${textArea('note','Catatan',o.note)}`;
 if(entity==='debt_payment')return `${select('debt_id','Hutang / piutang',d().debts.map(x=>[x.id,`${x.person} · sisa ${fmt(x.amount-x.paid)}`]),o.debt_id)}${selectAccount('account_id',o.account_id,'Akun untuk bayar / terima')}${amountInput('amount','Jumlah pembayaran (Rp)','')}${dateInput('paid_date','Tanggal')}`;
 return '';
}
function updateTxnFields(){
 const f=$('#modal-form');if(!f || !(st.modal?.entity==='transaction'||st.modal?.entity==='recurring'))return;
 const kind=f.elements.kind.value,trans=kind==='transfer';
 $('#extra-transfer').hidden=!trans;$('#extra-category').hidden=trans;
 const t=f.elements.to_account_id,catEl=f.elements.category_id;
 t.required=trans;catEl.required=!trans;
 if(!trans){
   const old=catEl.value;
   catEl.innerHTML=categoryOpts(kind).map(([v,l])=>`<option value="${v}" ${String(v)===old?'selected':''}>${esc(l)}</option>`).join('');
 }
}
function modalOpen(entity,obj={},id=null){
 if(!d().accounts.length && ['transaction','debt_payment','recurring'].includes(entity))return toast('Tambahkan akun terlebih dahulu.');
 st.modal={entity,id};
 const name={transaction:'transaksi',account:'akun',category:'kategori',budget:'budget',goal:'target',goal_deposit:'setoran target',debt:'hutang / piutang',debt_payment:'pembayaran',recurring:'transaksi berulang'}[entity]||entity;
 $('#modal-title').textContent=id?'Ubah '+name:'Tambah '+name;
 $('#modal-fields').innerHTML=fields(entity,obj);
 $('#modal-error').textContent='';
 $('#modal').showModal();
 if(['transaction','recurring'].includes(entity))updateTxnFields();
}
function modalClose(){$('#modal').close();st.modal=null;}
async function submitModal(ev){
 ev.preventDefault();const meta=st.modal;if(!meta)return;
 const form=ev.target;const data=Object.fromEntries(new FormData(form));
 if(meta.id)data.id=meta.id;
 if(meta.entity==='category' && meta.id)data.kind=find('categories',meta.id).kind; // field is disabled on edits
 if(meta.entity==='transaction'||meta.entity==='recurring'){
    if(data.kind==='transfer')delete data.category_id;
    else delete data.to_account_id;
    if(meta.entity==='recurring')data.active=data.active==='true';
 }
 if(data.archived!==undefined)data.archived=data.archived==='true';
 const btn=form.querySelector('[type=submit]');btn.disabled=true;$('#modal-error').textContent='';
 try{await api('/command',{method:'POST',body:JSON.stringify({entity:meta.entity,action:meta.id?'update':'create',data})});modalClose();toast('Data berhasil disimpan.');await load();}
 catch(e){$('#modal-error').textContent=e.message;}finally{btn.disabled=false;}
}
async function removeEntity(entity,id){
 const target=find(({transaction:'transactions',account:'accounts',category:'categories',budget:'budgets',goal:'goals',debt:'debts',recurring:'recurring'})[entity],id);
 if(!target)return;
 if(entity==='account'&&target.archived)return toast('Akun sudah diarsipkan. Gunakan Edit untuk mengaktifkannya.');
 if(entity==='category'&&target.archived)return toast('Kategori sudah diarsipkan. Gunakan Edit untuk mengaktifkannya.');
 const msg=entity==='debt'?'Menghapus catatan hutang/piutang akan menghapus pembayaran dan transaksi kas terkait. Yakin?':entity==='goal'?'Hapus target dan seluruh riwayat setorannya?': ['category','account'].includes(entity)?'Arsipkan data ini? Riwayat lama tetap tersimpan.':'Hapus data ini?';
 if(!confirm(msg))return;
 try{await api('/command',{method:'POST',body:JSON.stringify({entity,action:'delete',data:{id}})});toast('Perubahan berhasil disimpan.');await load();}
 catch(e){toast(e.message);}
}
function download(name,data){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}

window.addEventListener('DOMContentLoaded',async()=>{
  $('#month-picker').value=st.month;
  $('#login-form').addEventListener('submit',async e=>{
    e.preventDefault();const btn=e.target.querySelector('button');btn.disabled=true;
    $('#login-error').textContent='';
    try{
      const data=await api('/auth/login',{method:'POST',body:JSON.stringify({username:$('#login-name').value,password:$('#login-password').value})});
      st.csrf=data.csrf;st.user=data.username;$('#login-password').value='';await enter();
    } catch(err){$('#login-error').textContent=err.message;}finally{btn.disabled=false;}
  });
  $('#month-picker').addEventListener('change',e=>{if(e.target.value){st.month=e.target.value;st.filter='';load();}});
  $('#quick-add').addEventListener('click',()=>modalOpen('transaction'));
  $('#mobile-add').addEventListener('click',()=>modalOpen('transaction'));
  $('#mobile-menu').addEventListener('click',()=>$('#mobile-drawer').classList.toggle('hidden'));
  $('#drawer-close').addEventListener('click',()=>$('#mobile-drawer').classList.add('hidden'));
  $('#mobile-drawer').addEventListener('click',e=>{if(e.target.id==='mobile-drawer')$('#mobile-drawer').classList.add('hidden');});
  document.body.addEventListener('click',async e=>{
    const target=e.target.closest('button');if(!target || target.disabled)return;
    if(target.dataset.section){st.section=target.dataset.section;st.filter='';$('#mobile-drawer').classList.add('hidden');render();window.scrollTo({top:0,behavior:'smooth'});}
    if(target.dataset.new)modalOpen(target.dataset.new,target.dataset.new==='budget'?{month:st.month}:{});
    if(target.dataset.edit){const [entity,id]=target.dataset.edit.split(':'); const prop={transaction:'transactions',account:'accounts',category:'categories',budget:'budgets',goal:'goals',debt:'debts',recurring:'recurring'}[entity]; modalOpen(entity,find(prop,id),Number(id));}
    if(target.dataset.delete){const [entity,id]=target.dataset.delete.split(':');await removeEntity(entity,Number(id));}
    if(target.dataset.deposit)modalOpen('goal_deposit',{goal_id:target.dataset.deposit});
    if(target.dataset.pay)modalOpen('debt_payment',{debt_id:target.dataset.pay});
    if(target.id==='retry-load')load();
    if(target.id==='process-recurring'){
      target.disabled=true;try{const res=await api('/recurring/process',{method:'POST'});toast(res.processed?`${res.processed} transaksi rutin diproses.`:'Semua jadwal sudah diproses.');await load();}catch(err){toast(err.message)}finally{target.disabled=false;}
    }
    if(target.id==='logout'){
      try{await api('/auth/logout',{method:'POST'});showAuth();}catch(err){toast(err.message)}
    }
    if(target.id==='download-backup'){
      try{const data=await api('/backup');download(`keuangan-mandiri-${jakarta()}.json`,data);}catch(err){toast(err.message)}
    }
  });
  $('#content').addEventListener('input',e=>{
    if(e.target.id==='filter-transaction'){
      st.filter=e.target.value;
      $('#transaction-table').innerHTML=tableTransactions(d().transactions.filter(t=>[t.note,cat(t.category_id),acct(t.account_id),String(t.amount)].join(' ').toLowerCase().includes(st.filter.toLowerCase())));
    }
  });
  $('#modal-form').addEventListener('submit',submitModal);
  $('#modal-fields').addEventListener('change',e=>{if(e.target.name==='kind')updateTxnFields();});
  $('#modal-close').addEventListener('click',modalClose);
  $('#cancel-modal').addEventListener('click',modalClose);
  $('#modal').addEventListener('close',()=>{st.modal=null;});
  try { const user=await api('/auth/me');st.csrf=user.csrf;st.user=user.username;await enter(); }
  catch(e){showAuth();}
});
