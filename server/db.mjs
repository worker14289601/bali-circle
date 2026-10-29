import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

const seedReferralCodes = new Map([
  ['link-leo-visa', '05fce75e3502fed85f8beb50'],
  ['link-leo-extension', '7083750741ff0c63273cb8f0'],
  ['link-maya-visa', '32aa02566fa53bd9650e4071'],
  ['link-leo-cowork', 'af525695129026c0b675707e'],
]);

export const profiles = [
  { id: 'biz-visa', name: 'Лео', role: 'business', businessId: 'business-visa', businessName: 'Bali Visa Bureau', initials: 'Л', avatar: 'leo-avatar.jpg' },
  { id: 'partner-leo', name: 'Лео на Бали', role: 'partner', initials: 'ЛБ', avatar: 'leo-avatar.jpg' },
  { id: 'admin', name: 'Администратор', role: 'admin', initials: 'BC' },
  { id: 'biz-cowork', name: 'Ruang Cowork', role: 'business', businessId: 'business-cowork', initials: 'RC' },
  { id: 'partner-maya', name: 'Майя · Bali Guide', role: 'partner', initials: 'МГ' },
];

export function openDatabase(dbPath) {
  if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS businesses (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS offers (
      id TEXT PRIMARY KEY, businessId TEXT NOT NULL REFERENCES businesses(id),
      title TEXT NOT NULL, description TEXT NOT NULL, commission INTEGER NOT NULL CHECK(commission > 0),
      currency TEXT NOT NULL DEFAULT 'IDR', active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS links (
      id TEXT PRIMARY KEY, offerId TEXT NOT NULL REFERENCES offers(id), partnerId TEXT NOT NULL,
      partnerName TEXT NOT NULL, code TEXT NOT NULL UNIQUE, clicks INTEGER NOT NULL DEFAULT 0,
      UNIQUE(offerId, partnerId)
    );
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY, offerId TEXT NOT NULL REFERENCES offers(id), businessId TEXT NOT NULL REFERENCES businesses(id),
      partnerId TEXT NOT NULL, partnerName TEXT NOT NULL, clientName TEXT NOT NULL, contact TEXT NOT NULL,
      normalizedContact TEXT NOT NULL, comment TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('new','contacted','paid','cancelled')),
      saleAmount INTEGER, commission INTEGER NOT NULL CHECK(commission > 0), currency TEXT NOT NULL DEFAULT 'IDR',
      commissionStatus TEXT NOT NULL CHECK(commissionStatus IN ('pending','approved','paid','void')),
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, requestId TEXT UNIQUE
    );
    CREATE INDEX IF NOT EXISTS leads_business ON leads(businessId);
    CREATE INDEX IF NOT EXISTS leads_partner ON leads(partnerId);
    CREATE INDEX IF NOT EXISTS leads_contact ON leads(offerId, normalizedContact);
    CREATE TABLE IF NOT EXISTS payouts (
      id TEXT PRIMARY KEY, partnerId TEXT NOT NULL, partnerName TEXT NOT NULL,
      businessId TEXT NOT NULL REFERENCES businesses(id), amount INTEGER NOT NULL CHECK(amount > 0),
      currency TEXT NOT NULL DEFAULT 'IDR', reference TEXT NOT NULL, createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payout_items (
      payoutId TEXT NOT NULL REFERENCES payouts(id), leadId TEXT NOT NULL UNIQUE REFERENCES leads(id),
      PRIMARY KEY(payoutId, leadId)
    );
    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY, businessId TEXT NOT NULL REFERENCES businesses(id), partnerId TEXT,
      leadId TEXT REFERENCES leads(id), actor TEXT NOT NULL, message TEXT NOT NULL, createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, profileId TEXT NOT NULL, expiresAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS visits (
      linkId TEXT NOT NULL REFERENCES links(id), visitorId TEXT NOT NULL, createdAt TEXT NOT NULL,
      PRIMARY KEY(linkId, visitorId)
    );
  `);
  seedDatabase(db);
  migrateReferralCodes(db);
  return db;
}

function migrateReferralCodes(db) {
  const links = db.prepare('SELECT id,code FROM links').all();
  const legacy = links.filter((link) => !/^[a-f0-9]{24}$/.test(link.code));
  if (!legacy.length) return;
  const codes = new Set(links.map((link) => link.code));
  transaction(db, () => {
    const update = db.prepare('UPDATE links SET code=? WHERE id=?');
    for (const link of legacy) {
      let code = seedReferralCodes.get(link.id);
      if (!code || codes.has(code)) {
        do { code = randomBytes(12).toString('hex'); } while (codes.has(code));
      }
      update.run(code, link.id);
      codes.delete(link.code);
      codes.add(code);
    }
  });
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function addActivity(db, { businessId, partnerId = null, leadId = null, actor, message, createdAt = new Date().toISOString() }) {
  db.prepare('INSERT INTO activity(id,businessId,partnerId,leadId,actor,message,createdAt) VALUES(?,?,?,?,?,?,?)')
    .run(randomUUID(), businessId, partnerId, leadId, actor, message, createdAt);
}

function seedDatabase(db) {
  if (db.prepare('SELECT COUNT(*) AS count FROM businesses').get().count) return;
  transaction(db, () => {
    const business = db.prepare('INSERT INTO businesses(id,name,category,description) VALUES(?,?,?,?)');
    business.run('business-visa', 'Bali Visa Bureau', 'Визы и документы', 'Визовая поддержка на Бали: консультации, оформление и продление.');
    business.run('business-cowork', 'Ruang Cowork', 'Коворкинг', 'Спокойное рабочее пространство в Чангу для тех, кто работает удалённо.');
    const offer = db.prepare('INSERT INTO offers(id,businessId,title,description,commission,currency,active) VALUES(?,?,?,?,?,?,?)');
    offer.run('offer-visa', 'business-visa', 'Туристическая виза на Бали', 'Поможем с оформлением визы и документами. Менеджер уточнит вашу ситуацию и предложит подходящий вариант.', 150000, 'IDR', 1);
    offer.run('offer-extension', 'business-visa', 'Продление визы', 'Продлите пребывание на Бали с поддержкой на каждом этапе. Оставьте заявку для консультации.', 100000, 'IDR', 1);
    offer.run('offer-cowork', 'business-cowork', 'Месяц в Ruang Cowork', 'Рабочее место, быстрый интернет и сообщество в Чангу. Менеджер расскажет об абонементах.', 100000, 'IDR', 1);
    const link = db.prepare('INSERT INTO links(id,offerId,partnerId,partnerName,code,clicks) VALUES(?,?,?,?,?,?)');
    link.run('link-leo-visa', 'offer-visa', 'partner-leo', 'Лео на Бали', seedReferralCodes.get('link-leo-visa'), 46);
    link.run('link-leo-extension', 'offer-extension', 'partner-leo', 'Лео на Бали', seedReferralCodes.get('link-leo-extension'), 19);
    link.run('link-maya-visa', 'offer-visa', 'partner-maya', 'Майя · Bali Guide', seedReferralCodes.get('link-maya-visa'), 24);
    link.run('link-leo-cowork', 'offer-cowork', 'partner-leo', 'Лео на Бали', seedReferralCodes.get('link-leo-cowork'), 12);
    const entries = [
      ['BC-1048','offer-visa','business-visa','partner-leo','Лео на Бали','Александр К.','alex.demo@example.com','Планирую прилететь в ноябре.','new',null,150000,'pending','2026-10-30T01:20:00.000Z'],
      ['BC-1047','offer-visa','business-visa','partner-leo','Лео на Бали','Мария С.','maria.demo@example.com','Нужна консультация по документам.','contacted',null,150000,'pending','2026-10-29T10:40:00.000Z'],
      ['BC-1046','offer-visa','business-visa','partner-maya','Майя · Bali Guide','Даниил П.','daniel.demo@example.com','','paid',2400000,150000,'approved','2026-10-29T08:10:00.000Z'],
      ['BC-1045','offer-extension','business-visa','partner-leo','Лео на Бали','Анна М.','anna.demo@example.com','Продление на следующий месяц.','paid',1500000,100000,'approved','2026-10-28T11:15:00.000Z'],
      ['BC-1044','offer-visa','business-visa','partner-leo','Лео на Бали','Михаил Р.','mikhail.demo@example.com','','paid',2400000,150000,'paid','2026-10-27T06:30:00.000Z'],
      ['BC-1043','offer-extension','business-visa','partner-maya','Майя · Bali Guide','Ольга Н.','olga.demo@example.com','Клиент перенёс поездку.','cancelled',null,100000,'void','2026-10-26T07:00:00.000Z'],
      ['BC-1042','offer-cowork','business-cowork','partner-leo','Лео на Бали','Кирилл В.','kirill.demo@example.com','','new',null,100000,'pending','2026-10-29T04:30:00.000Z'],
      ['BC-1041','offer-cowork','business-cowork','partner-leo','Лео на Бали','Елена А.','elena.demo@example.com','','paid',1800000,100000,'approved','2026-10-28T03:00:00.000Z'],
    ];
    const lead = db.prepare(`INSERT INTO leads(id,offerId,businessId,partnerId,partnerName,clientName,contact,normalizedContact,comment,status,saleAmount,commission,currency,commissionStatus,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const [id, offerId, businessId, partnerId, partnerName, clientName, contact, comment, status, saleAmount, commission, commissionStatus, createdAt] of entries) {
      lead.run(id,offerId,businessId,partnerId,partnerName,clientName,contact,contact,comment,status,saleAmount,commission,'IDR',commissionStatus,createdAt,createdAt);
      addActivity(db, { businessId, partnerId, leadId:id, actor:partnerName, message:`Новая заявка ${id}`, createdAt });
      if (status === 'paid') addActivity(db,{businessId,partnerId,leadId:id,actor:businessId==='business-visa'?'Bali Visa Bureau':'Ruang Cowork',message:`Подтверждена оплата по заявке ${id}`,createdAt});
      if (status === 'cancelled') addActivity(db,{businessId,partnerId,leadId:id,actor:'Bali Visa Bureau',message:`Заявка ${id} отменена: клиент перенёс поездку`,createdAt});
    }
    db.prepare('INSERT INTO payouts(id,partnerId,partnerName,businessId,amount,currency,reference,createdAt) VALUES(?,?,?,?,?,?,?,?)')
      .run('payout-demo-1','partner-leo','Лео на Бали','business-visa',150000,'IDR','DEMO-TRANSFER-1027','2026-10-28T06:00:00.000Z');
    db.prepare('INSERT INTO payout_items(payoutId,leadId) VALUES(?,?)').run('payout-demo-1','BC-1044');
    addActivity(db,{businessId:'business-visa',partnerId:'partner-leo',actor:'Bali Visa Bureau',message:'Зафиксирована выплата Лео: 150 000 IDR · DEMO-TRANSFER-1027',createdAt:'2026-10-28T06:00:00.000Z'});
  });
}
