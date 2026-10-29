import express from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { openDatabase, profiles, transaction, addActivity } from './db.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DAY = 86_400_000;
const fail = (status, message) => Object.assign(new Error(message), { status });
const now = () => new Date().toISOString();
const clean = (value, min, max, label) => {
  if (typeof value !== 'string') throw fail(400, `Укажите ${label}.`);
  const text = value.trim();
  if (text.length < min || text.length > max) throw fail(400, `${label}: от ${min} до ${max} символов.`);
  return text;
};
const amount = (value, label, max = 1_000_000_000_000) => {
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) throw fail(400, `Укажите корректную сумму: ${label}.`);
  return value;
};
const cookieMap = (header = '') => Object.fromEntries(header.split(';').map((part) => {
  const index = part.indexOf('=');
  return index < 0 ? [] : [part.slice(0,index).trim(), part.slice(index+1)];
}).filter((item) => item.length === 2));
const mapOffer = (offer) => ({ ...offer, active: Boolean(offer.active) });
const publicLead = ({ id, status, createdAt }) => ({ id, status, createdAt });
function scoped(user, column = 'businessId') {
  if (user.role === 'business') return { where: ` WHERE ${column} = ?`, params: [user.businessId] };
  if (user.role === 'partner') return { where: ' WHERE partnerId = ?', params: [user.id] };
  return { where: '', params: [] };
}
function safeLead(row, user) {
  const { normalizedContact, requestId, ...lead } = row;
  if (user.role === 'partner') {
    lead.clientName = lead.clientName.split(/\s+/)[0];
    lead.contact = '';
    lead.comment = '';
  }
  return lead;
}

export async function createApp({ dbPath = process.env.DB_PATH || resolve(root,'data/bali-circle.sqlite'), serveFrontend = true } = {}) {
  const db = openDatabase(dbPath);
  const app = express();
  app.disable('x-powered-by');
  app.locals.db = db;
  let vite;
  app.locals.close = async () => { if (vite) await vite.close(); db.close(); };
  app.use((req,res,next) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options','DENY');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control','no-store');
    next();
  });
  app.use('/api', (req,res,next) => {
    if (!['POST','PATCH','PUT','DELETE'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (req.get('sec-fetch-site') === 'cross-site') return next(fail(403,'Запрос должен быть отправлен с этого сайта.'));
    if (origin) {
      try { if (new URL(origin).host !== req.get('host')) throw new Error(); }
      catch { return next(fail(403,'Запрос должен быть отправлен с этого сайта.')); }
    }
    if (!req.path.endsWith('/visit') && !req.is('application/json')) return next(fail(415,'Используйте JSON для этого запроса.'));
    next();
  });
  app.use(express.json({ limit:'24kb', strict:true }));
  app.use('/api',(req,res,next)=>{
    if(['POST','PATCH','PUT','DELETE'].includes(req.method)&&!req.path.endsWith('/visit')&&(!req.body||typeof req.body!=='object'||Array.isArray(req.body))) {
      return next(fail(400,'Передайте объект с данными запроса.'));
    }
    next();
  });
  app.use('/api', (req,res,next) => {
    const token = cookieMap(req.get('cookie')).bc_session;
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      const session = db.prepare('SELECT profileId FROM sessions WHERE token=? AND expiresAt>?').get(token,Date.now());
      req.user = session ? profiles.find((profile)=>profile.id===session.profileId) : null;
    }
    next();
  });
  const auth = (req,res,next) => req.user ? next() : next(fail(401,'Войдите в демо-кабинет.'));
  const business = (req,res,next) => req.user && req.user.role !== 'partner' ? next() : next(fail(403,'Это действие доступно бизнесу или администратору.'));
  const businessIdFor = (req) => {
    const id = req.user.role === 'business' ? req.user.businessId : req.body.businessId;
    if (typeof id !== 'string' || !db.prepare('SELECT id FROM businesses WHERE id=?').get(id)) throw fail(400,'Выберите бизнес.');
    return id;
  };

  app.get('/api/session',(req,res)=>res.json({user:req.user||null,profiles,demo:true}));
  app.post('/api/demo-login',(req,res,next)=>{
    try {
      const user = profiles.find((profile)=>profile.id===req.body.profileId);
      if (!user) throw fail(400,'Выберите демо-профиль.');
      const old = cookieMap(req.get('cookie')).bc_session;
      if (old) db.prepare('DELETE FROM sessions WHERE token=?').run(old);
      db.prepare('DELETE FROM sessions WHERE expiresAt<?').run(Date.now());
      const token=randomBytes(32).toString('hex');
      db.prepare('INSERT INTO sessions(token,profileId,expiresAt) VALUES(?,?,?)').run(token,user.id,Date.now()+7*DAY);
      res.cookie('bc_session',token,{httpOnly:true,sameSite:'strict',path:'/',maxAge:7*DAY});
      res.json({user});
    } catch(error){next(error);}
  });
  app.post('/api/logout',(req,res)=>{
    const token=cookieMap(req.get('cookie')).bc_session;
    if(token) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
    res.clearCookie('bc_session',{httpOnly:true,sameSite:'strict',path:'/'});
    res.json({ok:true});
  });

  const dashboard = (user) => {
    const scope=scoped(user);
    const leads=db.prepare(`SELECT * FROM leads${scope.where} ORDER BY createdAt DESC`).all(...scope.params).map((row)=>safeLead(row,user));
    let businesses, offers, links;
    if(user.role==='business') {
      businesses=db.prepare('SELECT * FROM businesses WHERE id=?').all(user.businessId);
      offers=db.prepare('SELECT * FROM offers WHERE businessId=? ORDER BY rowid').all(user.businessId).map(mapOffer);
      links=db.prepare('SELECT links.* FROM links JOIN offers ON offers.id=links.offerId WHERE offers.businessId=? ORDER BY links.rowid').all(user.businessId);
    } else {
      businesses=db.prepare('SELECT * FROM businesses ORDER BY rowid').all();
      offers=db.prepare('SELECT * FROM offers ORDER BY rowid').all().map(mapOffer);
      links=user.role==='partner' ? db.prepare('SELECT * FROM links WHERE partnerId=? ORDER BY rowid').all(user.id) : db.prepare('SELECT * FROM links ORDER BY rowid').all();
    }
    const payouts=db.prepare(`SELECT * FROM payouts${scope.where} ORDER BY createdAt DESC`).all(...scope.params);
    const activity=db.prepare(`SELECT id,leadId,actor,message,createdAt FROM activity${scope.where} ORDER BY createdAt DESC,rowid DESC LIMIT 60`).all(...scope.params);
    return {user,businesses,offers,links,leads,payouts,activity};
  };
  app.get('/api/dashboard',auth,(req,res)=>res.json(dashboard(req.user)));
  app.post('/api/offers',auth,business,(req,res,next)=>{
    try{
      const businessId=businessIdFor(req);
      const offer={id:`offer-${randomUUID()}`,businessId,title:clean(req.body.title,3,100,'название'),description:clean(req.body.description,10,1000,'описание'),commission:amount(req.body.commission,'комиссия',100_000_000),currency:'IDR',active:true};
      transaction(db,()=>{
        db.prepare('INSERT INTO offers(id,businessId,title,description,commission,currency,active) VALUES(?,?,?,?,?,?,1)').run(offer.id,businessId,offer.title,offer.description,offer.commission,offer.currency);
        addActivity(db,{businessId,actor:req.user.name,message:`Создано предложение «${offer.title}»`});
      });
      res.status(201).json({offer});
    }catch(error){next(error);}
  });
  app.post('/api/links',auth,(req,res,next)=>{
    try{
      const offer=db.prepare('SELECT * FROM offers WHERE id=? AND active=1').get(req.body.offerId||'');
      if(!offer) throw fail(404,'Предложение не найдено.');
      if(req.user.role==='business'&&offer.businessId!==req.user.businessId) throw fail(404,'Предложение не найдено.');
      const partner=req.user.role==='partner'?req.user:profiles.find((p)=>p.id==='partner-leo');
      const existing=db.prepare('SELECT * FROM links WHERE offerId=? AND partnerId=?').get(offer.id,partner.id);
      if(existing) return res.json({link:existing});
      const link={id:randomUUID(),offerId:offer.id,partnerId:partner.id,partnerName:partner.name,code:randomBytes(12).toString('hex'),clicks:0};
      transaction(db,()=>{
        db.prepare('INSERT INTO links(id,offerId,partnerId,partnerName,code,clicks) VALUES(?,?,?,?,?,0)').run(link.id,link.offerId,link.partnerId,link.partnerName,link.code);
        addActivity(db,{businessId:offer.businessId,partnerId:partner.id,actor:req.user.name,message:`Создана партнёрская ссылка для «${offer.title}»`});
      });
      res.status(201).json({link});
    }catch(error){next(error);}
  });
  const referral=(code)=>{
    if(typeof code!=='string'||code.length>100) throw fail(404,'Ссылка не найдена.');
    const link=db.prepare('SELECT * FROM links WHERE code=?').get(code);
    if(!link) throw fail(404,'Ссылка не найдена.');
    const offer=db.prepare('SELECT * FROM offers WHERE id=? AND active=1').get(link.offerId);
    if(!offer) throw fail(404,'Предложение больше не доступно.');
    const owner=db.prepare('SELECT * FROM businesses WHERE id=?').get(offer.businessId);
    return {link,offer:mapOffer(offer),business:owner};
  };
  app.get('/api/referrals/:code',(req,res,next)=>{
    try{ const {link,offer,business:owner}=referral(req.params.code); res.json({offer,business:owner,partnerName:link.partnerName,code:link.code}); }
    catch(error){next(error);}
  });
  app.post('/api/referrals/:code/visit',(req,res,next)=>{
    try{
      const {link}=referral(req.params.code);
      let visitor=cookieMap(req.get('cookie')).bc_visitor;
      if(!visitor||!/^[a-f0-9]{32}$/.test(visitor)) {
        visitor=randomBytes(16).toString('hex');
        res.cookie('bc_visitor',visitor,{httpOnly:true,sameSite:'strict',path:'/',maxAge:30*DAY});
      }
      transaction(db,()=>{
        const result=db.prepare('INSERT OR IGNORE INTO visits(linkId,visitorId,createdAt) VALUES(?,?,?)').run(link.id,visitor,now());
        if(result.changes) db.prepare('UPDATE links SET clicks=clicks+1 WHERE id=?').run(link.id);
      });
      res.json({ok:true});
    }catch(error){next(error);}
  });
  app.post('/api/referrals/:code/leads',(req,res,next)=>{
    try{
      const {link,offer}=referral(req.params.code);
      const clientName=clean(req.body.clientName,2,80,'имя');
      const contact=clean(req.body.contact,5,120,'WhatsApp или email');
      const email=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const phone=/^\+?[\d\s()-]{7,25}$/;
      if(!email.test(contact)&&!phone.test(contact)) throw fail(400,'Укажите email или телефон с кодом страны.');
      if(req.body.consent!==true) throw fail(400,'Подтвердите согласие на передачу контакта бизнесу.');
      const comment=req.body.comment===undefined?'':clean(req.body.comment,0,500,'комментарий');
      const requestId=clean(req.body.requestId,8,100,'идентификатор заявки');
      if(!/^[\w-]+$/.test(requestId)) throw fail(400,'Некорректный идентификатор заявки.');
      const normalizedContact=email.test(contact)?contact.toLowerCase():contact.replace(/\D/g,'');
      const prior=db.prepare('SELECT * FROM leads WHERE requestId=?').get(requestId);
      if(prior) {
        if(prior.offerId!==offer.id||prior.partnerId!==link.partnerId||prior.normalizedContact!==normalizedContact) throw fail(409,'Идентификатор заявки уже использован.');
        return res.json({lead:publicLead(prior),duplicate:true});
      }
      const duplicate=db.prepare("SELECT * FROM leads WHERE offerId=? AND normalizedContact=? AND status<>'cancelled' ORDER BY createdAt DESC LIMIT 1").get(offer.id,normalizedContact);
      if(duplicate) return res.status(409).json({error:'Заявка с этим контактом уже есть. Свяжитесь с бизнесом, чтобы уточнить её статус.'});
      const createdAt=now();
      const lead={id:`BC-${randomBytes(3).toString('hex').toUpperCase()}`,offerId:offer.id,businessId:offer.businessId,partnerId:link.partnerId,partnerName:link.partnerName,clientName,contact,comment,status:'new',saleAmount:null,commission:offer.commission,currency:offer.currency,commissionStatus:'pending',createdAt,updatedAt:createdAt};
      transaction(db,()=>{
        db.prepare(`INSERT INTO leads(id,offerId,businessId,partnerId,partnerName,clientName,contact,normalizedContact,comment,status,saleAmount,commission,currency,commissionStatus,createdAt,updatedAt,requestId) VALUES(?,?,?,?,?,?,?,?,?,'new',NULL,?,?, 'pending',?,?,?)`)
          .run(lead.id,lead.offerId,lead.businessId,lead.partnerId,lead.partnerName,clientName,contact,normalizedContact,comment,lead.commission,lead.currency,createdAt,createdAt,requestId);
        addActivity(db,{businessId:lead.businessId,partnerId:lead.partnerId,leadId:lead.id,actor:lead.partnerName,message:`Новая заявка ${lead.id}`,createdAt});
      });
      res.status(201).json({lead:publicLead(lead)});
    }catch(error){next(error);}
  });
  app.patch('/api/leads/:id',auth,business,(req,res,next)=>{
    try{
      const lead=db.prepare('SELECT * FROM leads WHERE id=?').get(req.params.id);
      if(!lead||(req.user.role==='business'&&lead.businessId!==req.user.businessId)) throw fail(404,'Заявка не найдена.');
      const status=req.body.status;
      const transitions={new:['contacted','paid','cancelled'],contacted:['paid','cancelled'],paid:['cancelled'],cancelled:[]};
      if(!transitions[lead.status].includes(status)) throw fail(409,'Этот переход статуса недоступен. Обновите список заявок.');
      if(lead.commissionStatus==='paid') throw fail(409,'Комиссия уже выплачена. Изменение требует отдельной сверки.');
      const saleAmount=status==='paid'?amount(req.body.saleAmount,'сумма продажи'):lead.saleAmount;
      const reason=status==='cancelled'?clean(req.body.reason,3,300,'причину отмены'):null;
      const commissionStatus=status==='paid'?'approved':status==='cancelled'?'void':lead.commissionStatus;
      const message=status==='paid'?`Подтверждена оплата по заявке ${lead.id}`:status==='cancelled'?`Заявка ${lead.id} отменена: ${reason}`:`Заявка ${lead.id}: связались с клиентом`;
      transaction(db,()=>{
        const result=db.prepare('UPDATE leads SET status=?,saleAmount=?,commissionStatus=?,updatedAt=? WHERE id=? AND status=? AND commissionStatus=?').run(status,saleAmount,commissionStatus,now(),lead.id,lead.status,lead.commissionStatus);
        if(!result.changes) throw fail(409,'Заявка уже изменена. Обновите страницу.');
        addActivity(db,{businessId:lead.businessId,partnerId:lead.partnerId,leadId:lead.id,actor:req.user.name,message});
      });
      res.json({lead:safeLead(db.prepare('SELECT * FROM leads WHERE id=?').get(lead.id),req.user)});
    }catch(error){next(error);}
  });
  app.post('/api/payouts',auth,business,(req,res,next)=>{
    try{
      const businessId=businessIdFor(req);
      const partner=profiles.find((profile)=>profile.id===req.body.partnerId&&profile.role==='partner');
      if(!partner) throw fail(400,'Выберите партнёра.');
      const reference=clean(req.body.reference,3,120,'номер или комментарий перевода');
      const expectedAmount=amount(req.body.expectedAmount,'ожидаемая сумма выплаты');
      const payout=transaction(db,()=>{
        const leads=db.prepare("SELECT id,commission FROM leads WHERE businessId=? AND partnerId=? AND status='paid' AND commissionStatus='approved'").all(businessId,partner.id);
        if(!leads.length) throw fail(409,'Нет подтверждённых начислений для выплаты.');
        const total=leads.reduce((sum,lead)=>sum+lead.commission,0);
        if(total!==expectedAmount) throw fail(409,'Сумма начислений изменилась. Обновите список и сверьте сумму перевода перед записью выплаты.');
        const row={id:randomUUID(),businessId,partnerId:partner.id,partnerName:partner.name,amount:total,currency:'IDR',reference,createdAt:now()};
        db.prepare('INSERT INTO payouts(id,businessId,partnerId,partnerName,amount,currency,reference,createdAt) VALUES(?,?,?,?,?,?,?,?)').run(row.id,businessId,partner.id,partner.name,total,'IDR',reference,row.createdAt);
        const item=db.prepare('INSERT INTO payout_items(payoutId,leadId) VALUES(?,?)');
        const mark=db.prepare("UPDATE leads SET commissionStatus='paid',updatedAt=? WHERE id=? AND commissionStatus='approved'");
        for(const lead of leads) { item.run(row.id,lead.id); if(!mark.run(row.createdAt,lead.id).changes) throw fail(409,'Начисление уже изменено.'); }
        addActivity(db,{businessId,partnerId:partner.id,actor:req.user.name,message:`Зафиксирована выплата ${partner.name}: ${total.toLocaleString('ru-RU')} IDR · ${reference}`,createdAt:row.createdAt});
        return row;
      });
      res.status(201).json({payout});
    }catch(error){next(error);}
  });
  app.get('/api/export.csv',auth,(req,res)=>{
    const data=dashboard(req.user);
    const csv=(value)=>{
      let text=value===null||value===undefined?'':String(value);
      if(/^[\s]*[=+@-]/.test(text)) text=`'${text}`;
      return `"${text.replaceAll('"','""')}"`;
    };
    const columns=['Номер','Клиент','Контакт','Партнёр','Статус','Сумма продажи','Комиссия','Статус комиссии','Валюта','Создана'];
    const rows=data.leads.map((lead)=>[lead.id,lead.clientName,lead.contact,lead.partnerName,lead.status,lead.saleAmount,lead.commission,lead.commissionStatus,lead.currency,lead.createdAt]);
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename="bali-circle-leads.csv"');
    res.send('\uFEFF'+[columns,...rows].map((row)=>row.map(csv).join(',')).join('\r\n'));
  });
  app.use('/api',(req,res)=>res.status(404).json({error:'Такой API-маршрут не найден.'}));

  if(serveFrontend) {
    if(process.env.NODE_ENV==='production') {
      const indexPath=resolve(root,'dist/index.html');
      if(!existsSync(indexPath)) throw new Error('Сначала выполните npm run build.');
      app.use(express.static(resolve(root,'dist'),{index:false}));
      app.use((req,res,next)=>req.method==='GET'?res.sendFile(indexPath):next());
    } else {
      const {createServer}=await import('vite');
      vite=await createServer({root,server:{middlewareMode:true},appType:'spa'});
      app.use(vite.middlewares);
    }
  }
  app.use((error,req,res,next)=>{
    if(res.headersSent) return next(error);
    const status=error.status||500;
    if(status>=500) console.error(error);
    res.status(status).json({error:status>=500?'Не удалось выполнить действие. Попробуйте ещё раз.':error.type==='entity.parse.failed'?'Некорректный JSON.':error.message});
  });
  return app;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const port=Number(process.env.PORT||4173);
  const app=await createApp();
  const server=app.listen(port,'127.0.0.1',()=>console.log(`Bali Circle — http://127.0.0.1:${port}`));
  const shutdown=()=>server.close(async()=>{await app.locals.close();process.exit(0);});
  process.on('SIGINT',shutdown);
  process.on('SIGTERM',shutdown);
}
