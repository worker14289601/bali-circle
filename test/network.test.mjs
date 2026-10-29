import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';
import { build } from 'esbuild';
import { createApp } from '../server/index.mjs';
import { openDatabase } from '../server/db.mjs';

const seed = JSON.parse(readFileSync(new URL('../src/demo-seed.json', import.meta.url), 'utf8'));
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const storageKey = 'bali-circle-demo-v1';
const leoInvite = seed.invites['partner-leo'];
let directory;
let modulePath;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'bali-circle-network-'));
  modulePath = path.join(directory, 'demo.mjs');
  await build({ entryPoints: [path.join(projectRoot, 'src/demo.ts')], outfile: modulePath, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
});

after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

const leadBody = () => ({ clientName: 'Клиент Сети', contact: `network-${randomUUID()}@example.test`, consent: true, requestId: randomUUID() });
const sum = (items, key) => items.reduce((total, item) => total + item[key], 0);
const dueForLeo = (state) => sum(state.leads.filter((lead) => lead.partnerId === 'partner-leo' && lead.commissionStatus === 'approved'), 'commission')
  + sum(state.bonuses.filter((bonus) => bonus.bonusPartnerId === 'partner-leo' && bonus.status === 'approved'), 'amount');

async function serverClient(t, dbPath) {
  const dir = dbPath ? null : await mkdtemp(path.join(tmpdir(), 'bali-circle-network-api-'));
  const app = await createApp({ dbPath: dbPath || path.join(dir, 'test.sqlite'), serveFrontend: false });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await app.locals.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });
  let cookie;
  const request = async (url, method = 'GET', body) => {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    if (method !== 'GET') headers.origin = origin;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(`${origin}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie?.startsWith('bc_session=')) cookie = setCookie.split(';')[0];
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error), { status: response.status });
    return data;
  };
  const expireInvite = (partnerId) => app.locals.db.prepare('UPDATE network SET invitedAt=? WHERE partnerId=?').run('2024-01-01T00:00:00.000Z', partnerId);
  return { request, login: (profileId) => request('/api/demo-login', 'POST', { profileId }), expireInvite };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(String(key)) ?? null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: (key) => values.delete(String(key)),
  };
}

async function browserClient(t, initialState) {
  const localStorage = memoryStorage();
  if (initialState) localStorage.setItem(storageKey, JSON.stringify(initialState));
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: localStorage, configurable: true });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  });
  const load = async () => {
    const module = await import(`${pathToFileURL(modulePath).href}?network=${randomUUID()}`);
    const request = (url, method = 'GET', body) => module.demoRequest(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { request, login: (profileId) => request('/api/demo-login', 'POST', { profileId }) };
  };
  const expireInvite = (partnerId) => {
    const state = JSON.parse(localStorage.getItem(storageKey));
    state.network.find((item) => item.partnerId === partnerId).invitedAt = '2024-01-01T00:00:00.000Z';
    localStorage.setItem(storageKey, JSON.stringify(state));
  };
  return { ...await load(), load, localStorage, expireInvite };
}

// The same rules hold for the SQLite server and the browser-only Pages demo.
async function invitedBloggerEarnsBonusForInviter({ request, login }) {
  await login('partner-leo');
  const leo = await request('/api/dashboard');
  assert.equal(leo.network.inviteCode, leoInvite);
  assert.equal(leo.network.invitedBy, null);
  const maya = leo.network.members.find((member) => member.id === 'partner-maya');
  assert.equal(maya.bonusEarned, 15000 + 7500, 'seeded paid sales of Maya accrue Leo a network bonus');
  assert.ok(leo.bonuses.every((bonus) => bonus.bonusPartnerId === 'partner-leo'));

  assert.equal((await request(`/api/invites/${leoInvite}`)).inviter.name, 'Лео на Бали');
  await assert.rejects(() => request('/api/invites/not-a-code'), /Приглашение не найдено/);
  await assert.rejects(() => request(`/api/invites/${leoInvite}/join`, 'POST', { name: 'Аня ест Бали' }), /условия/);
  await assert.rejects(() => request(`/api/invites/${leoInvite}/join`, 'POST', { name: 'майя · bali guide', consent: true }), /таким именем/);
  const { user } = await request(`/api/invites/${leoInvite}/join`, 'POST', { name: 'Аня ест Бали', consent: true });
  assert.equal(user.role, 'partner');
  assert.equal((await request('/api/session')).user.id, user.id, 'joining opens the new blogger cabinet');
  const anya = await request('/api/dashboard');
  assert.equal(anya.network.invitedBy.name, 'Лео на Бали');
  assert.match(anya.network.inviteCode, /^[a-f0-9]{24}$/);
  assert.notEqual(anya.network.inviteCode, leoInvite);

  const visaLink = (await request('/api/links', 'POST', { offerId: 'offer-visa' })).link;
  const coworkLink = (await request('/api/links', 'POST', { offerId: 'offer-cowork' })).link;
  const visaLead = (await request(`/api/referrals/${visaLink.code}/leads`, 'POST', leadBody())).lead;
  const coworkLead = (await request(`/api/referrals/${coworkLink.code}/leads`, 'POST', leadBody())).lead;

  await login('biz-visa');
  let visa = await request('/api/dashboard');
  let lead = visa.leads.find((item) => item.id === visaLead.id);
  assert.equal(lead.partnerId, user.id);
  assert.equal(lead.commission, 150000, 'the invited blogger keeps the full commission');
  assert.deepEqual([lead.bonusPartnerId, lead.bonusAmount, lead.bonusStatus], ['partner-leo', 15000, 'pending']);
  await request(`/api/leads/${lead.id}`, 'PATCH', { status: 'paid', saleAmount: 2000000 });
  visa = await request('/api/dashboard');
  lead = visa.leads.find((item) => item.id === visaLead.id);
  assert.equal(lead.commissionStatus, 'approved');
  assert.equal(lead.bonusStatus, 'approved');

  const expectedAmount = dueForLeo(visa);
  const { payout } = await request('/api/payouts', 'POST', { partnerId: 'partner-leo', reference: 'NETWORK-001', expectedAmount });
  assert.equal(payout.amount, expectedAmount);
  visa = await request('/api/dashboard');
  lead = visa.leads.find((item) => item.id === visaLead.id);
  assert.equal(lead.bonusStatus, 'paid');
  assert.equal(lead.commissionStatus, 'approved', 'paying the inviter does not settle the invited blogger');
  await assert.rejects(() => request(`/api/leads/${lead.id}`, 'PATCH', { status: 'cancelled', reason: 'Отмена после выплаты бонуса' }), /бонус уже выплачен/);
  await assert.rejects(() => request('/api/payouts', 'POST', { partnerId: 'partner-leo', reference: 'NETWORK-002', expectedAmount }));
  const own = await request('/api/payouts', 'POST', { partnerId: user.id, reference: 'NETWORK-003', expectedAmount: 150000 });
  assert.equal(own.payout.amount, 150000);

  await login('biz-cowork');
  const cowork = (await request('/api/dashboard')).leads.find((item) => item.id === coworkLead.id);
  assert.deepEqual([cowork.bonusAmount, cowork.bonusStatus], [0, null], 'offers with a 0% network bonus accrue nothing');

  await login('partner-leo');
  const after = await request('/api/dashboard');
  const anyaRow = after.network.members.find((member) => member.id === user.id);
  assert.deepEqual([anyaRow.leadCount, anyaRow.paidCount, anyaRow.bonusEarned], [2, 1, 15000]);
  assert.equal(after.bonuses.find((bonus) => bonus.leadId === visaLead.id).status, 'paid');
  assert.ok(!after.leads.some((item) => item.id === visaLead.id), 'the inviter sees the bonus, not the client lead');

  await login(user.id);
  assert.deepEqual((await request('/api/dashboard')).bonuses, []);
  return user;
}

async function bonusEndsAfterTwelveMonths({ request, login, expireInvite }) {
  await login('partner-maya');
  const link = (await request('/api/links', 'POST', { offerId: 'offer-visa' })).link;
  expireInvite('partner-maya');
  const created = (await request(`/api/referrals/${link.code}/leads`, 'POST', leadBody())).lead;
  await login('biz-visa');
  const lead = (await request('/api/dashboard')).leads.find((item) => item.id === created.id);
  assert.deepEqual([lead.bonusAmount, lead.bonusStatus], [0, null]);
  await assert.rejects(() => request('/api/offers', 'POST', { title: 'Слишком щедро', description: 'Проверка предела бонуса.', commission: 1000, networkBonus: 60 }), /от 0 до 50/);
  const { offer } = await request('/api/offers', 'POST', { title: 'Без сетевого бонуса', description: 'Бонус по умолчанию равен нулю.', commission: 1000 });
  assert.equal(offer.networkBonus, 0);
}

test('server: an invited blogger earns the inviter a network bonus paid by the business on top', async (t) => {
  await invitedBloggerEarnsBonusForInviter(await serverClient(t));
});

test('server: the network bonus stops 12 months after joining, and offers validate the percentage', async (t) => {
  await bonusEndsAfterTwelveMonths(await serverClient(t));
});

test('Pages demo: an invited blogger earns the inviter a network bonus paid by the business on top', async (t) => {
  const client = await browserClient(t);
  const user = await invitedBloggerEarnsBonusForInviter(client);
  const reloaded = await client.load();
  const session = await reloaded.request('/api/session');
  assert.ok(session.profiles.some((profile) => profile.id === user.id), 'joined bloggers survive a reload');
});

test('Pages demo: the network bonus stops 12 months after joining, and offers validate the percentage', async (t) => {
  await bonusEndsAfterTwelveMonths(await browserClient(t));
});

test('server: the network example is added to an existing database once and keeps saved work', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bali-circle-network-migration-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, 'legacy.sqlite');
  let db = openDatabase(dbPath);
  try {
    db.exec(`
      DELETE FROM activity WHERE leadId='BC-1052';
      DELETE FROM leads WHERE id='BC-1052';
      DELETE FROM links WHERE id='link-maya-dinner';
      DROP TABLE network; DROP TABLE invites; DROP TABLE members; DROP TABLE payout_bonus_items;
      DROP INDEX leads_bonus_partner;
      ALTER TABLE leads DROP COLUMN bonusPartnerId; ALTER TABLE leads DROP COLUMN bonusPartnerName;
      ALTER TABLE leads DROP COLUMN bonusAmount; ALTER TABLE leads DROP COLUMN bonusStatus;
      ALTER TABLE offers DROP COLUMN networkBonus;
      UPDATE leads SET comment='Сохранённая работа' WHERE id='BC-1048';
    `);
  } finally { db.close(); }

  db = openDatabase(dbPath);
  try {
    assert.equal(db.prepare('SELECT comment FROM leads WHERE id=?').get('BC-1048').comment, 'Сохранённая работа');
    assert.equal(db.prepare('SELECT networkBonus FROM offers WHERE id=?').get('offer-visa').networkBonus, 10);
    assert.deepEqual({ ...db.prepare('SELECT bonusPartnerId,bonusAmount,bonusStatus FROM leads WHERE id=?').get('BC-1046') }, { bonusPartnerId: 'partner-leo', bonusAmount: 15000, bonusStatus: 'approved' });
    assert.equal(db.prepare('SELECT bonusAmount FROM leads WHERE id=?').get('BC-1048').bonusAmount, 0);
    assert.equal(db.prepare('SELECT code FROM invites WHERE partnerId=?').get('partner-leo').code, leoInvite);
    db.prepare("UPDATE leads SET status='cancelled' WHERE id='BC-1052'").run();
  } finally { db.close(); }

  const { request, login } = await serverClient(t, dbPath);
  await login('admin');
  const overview = await request('/api/dashboard');
  assert.equal(overview.leads.filter((lead) => lead.id === 'BC-1052').length, 1);
  assert.equal(overview.leads.find((lead) => lead.id === 'BC-1052').status, 'cancelled', 'reopening does not reset the network example');
});

test('Pages demo: saved browser data gains the network example once without losing work or the selected account', async (t) => {
  const legacy = structuredClone(seed);
  for (const key of ['networkVersion', 'members', 'network', 'invites']) delete legacy[key];
  for (const offer of legacy.offers) delete offer.networkBonus;
  for (const lead of legacy.leads) for (const key of ['bonusPartnerId', 'bonusPartnerName', 'bonusAmount', 'bonusStatus']) delete lead[key];
  legacy.leads = legacy.leads.filter((lead) => lead.id !== 'BC-1052');
  legacy.links = legacy.links.filter((link) => link.id !== 'link-maya-dinner');
  legacy.activity = legacy.activity.filter((event) => event.leadId !== 'BC-1052');
  legacy.offers.push({ id: 'offer-saved', businessId: 'business-visa', title: 'Сохранённое предложение', description: 'Создано до сетевых бонусов.', commission: 90000, currency: 'IDR', active: true });
  const custom = { ...legacy.leads.find((lead) => lead.id === 'BC-1048'), id: 'BC-SAVED-NETWORK', contact: 'saved-network@example.test', comment: 'Моя заявка' };
  legacy.leads.push(custom);
  legacy.currentProfileId = 'biz-visa';

  const { request, login, load } = await browserClient(t, legacy);
  assert.equal((await request('/api/session')).user.id, 'biz-visa');
  const visa = await request('/api/dashboard');
  assert.equal(visa.offers.find((offer) => offer.id === 'offer-visa').networkBonus, 10);
  assert.equal(visa.offers.find((offer) => offer.id === 'offer-saved').networkBonus, 0);
  const seeded = visa.leads.find((lead) => lead.id === 'BC-1046');
  assert.deepEqual([seeded.bonusPartnerId, seeded.bonusAmount, seeded.bonusStatus], ['partner-leo', 15000, 'approved']);
  const saved = visa.leads.find((lead) => lead.id === custom.id);
  assert.deepEqual([saved.comment, saved.bonusAmount, saved.bonusStatus], ['Моя заявка', 0, null]);

  await login('partner-leo');
  assert.ok((await request('/api/dashboard')).network.members.some((member) => member.id === 'partner-maya'));
  await login('admin');
  const reloaded = await load();
  const overview = await reloaded.request('/api/dashboard');
  assert.equal(overview.leads.filter((lead) => lead.id === 'BC-1052').length, 1, 'reload does not duplicate the network example');
});
