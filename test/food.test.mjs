import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';
import { build } from 'esbuild';
import { openDatabase, profiles } from '../server/db.mjs';

const seed = JSON.parse(readFileSync(new URL('../src/demo-seed.json', import.meta.url), 'utf8'));
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const storageKey = 'bali-circle-demo-v1';
let directory;
let modulePath;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'bali-circle-food-'));
  modulePath = path.join(directory, 'demo.mjs');
  await build({ entryPoints: [path.join(projectRoot, 'src/demo.ts')], outfile: modulePath, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
});

after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(String(key)) ?? null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: (key) => values.delete(String(key)),
  };
}

async function browserFixture(t, initialState) {
  const localStorage = memoryStorage();
  if (initialState) localStorage.setItem(storageKey, JSON.stringify(initialState));
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: localStorage, configurable: true });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  });
  const load = async () => {
    const module = await import(`${pathToFileURL(modulePath).href}?food=${randomUUID()}`);
    const request = (url, method = 'GET', body) => module.demoRequest(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const login = (profileId) => request('/api/demo-login', 'POST', { profileId });
    return { request, login };
  };
  return { ...await load(), load, localStorage };
}

test('food example is added to an existing SQLite database once and preserves work on reopen', async () => {
  const dbPath = path.join(directory, 'food-migration.sqlite');
  let db = openDatabase(dbPath);
  try {
    db.exec(`
      DELETE FROM activity WHERE businessId='business-food';
      DELETE FROM visits WHERE linkId IN (SELECT id FROM links WHERE offerId='offer-dinner');
      DELETE FROM links WHERE offerId='offer-dinner';
      DELETE FROM payout_items WHERE leadId IN (SELECT id FROM leads WHERE businessId='business-food');
      DELETE FROM payouts WHERE businessId='business-food';
      DELETE FROM leads WHERE businessId='business-food';
      DELETE FROM offers WHERE businessId='business-food';
      DELETE FROM businesses WHERE id='business-food';
      UPDATE leads SET status='contacted',comment='Сохранить существующую заявку' WHERE id='BC-1048';
    `);
  } finally { db.close(); }

  db = openDatabase(dbPath);
  let code;
  let eventCount;
  try {
    const offer = db.prepare('SELECT * FROM offers WHERE id=?').get('offer-dinner');
    assert.equal(offer.businessId, 'business-food');
    assert.equal(offer.commission, 75000);
    assert.equal(db.prepare('SELECT name FROM businesses WHERE id=?').get('business-food').name, 'шMargaret');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM leads WHERE businessId=?').get('business-food').count, 3);
    assert.equal(db.prepare('SELECT comment FROM leads WHERE id=?').get('BC-1051').comment, 'Хочу столик на двоих в пятницу на 19:00');
    assert.equal(db.prepare('SELECT status FROM leads WHERE id=?').get('BC-1048').status, 'contacted');
    assert.equal(db.prepare('SELECT comment FROM leads WHERE id=?').get('BC-1048').comment, 'Сохранить существующую заявку');
    code = db.prepare('SELECT code FROM links WHERE id=?').get('link-leo-dinner').code;
    assert.match(code, /^[a-f0-9]{24}$/);
    eventCount = db.prepare('SELECT COUNT(*) AS count FROM activity WHERE businessId=?').get('business-food').count;
    db.prepare('UPDATE leads SET status=? WHERE id=?').run('contacted', 'BC-1051');
  } finally { db.close(); }

  db = openDatabase(dbPath);
  try {
    assert.equal(db.prepare('SELECT status FROM leads WHERE id=?').get('BC-1051').status, 'contacted', 'reopening must not reset changed food records');
    assert.equal(db.prepare('SELECT code FROM links WHERE id=?').get('link-leo-dinner').code, code);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM leads WHERE businessId=?').get('business-food').count, 3);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM activity WHERE businessId=?').get('business-food').count, eventCount);
    assert.equal(profiles[0].id, 'biz-food');
  } finally { db.close(); }
});

test('food example migrates saved browser data without changing the selected account or existing records', async (t) => {
  const legacy = structuredClone(seed);
  legacy.profiles = legacy.profiles.filter((profile) => profile.id !== 'biz-food');
  legacy.businesses = legacy.businesses.filter((business) => business.id !== 'business-food');
  legacy.offers = legacy.offers.filter((offer) => offer.businessId !== 'business-food');
  legacy.links = legacy.links.filter((link) => link.offerId !== 'offer-dinner');
  legacy.leads = legacy.leads.filter((lead) => lead.businessId !== 'business-food');
  legacy.activity = legacy.activity.filter((event) => event.businessId !== 'business-food');
  legacy.currentProfileId = 'biz-visa';
  const custom = { ...legacy.leads.find((lead) => lead.businessId === 'business-visa'), id: 'BC-CUSTOM-FOOD', contact: 'food-migration@example.test', comment: 'Моя сохранённая заявка', status: 'contacted' };
  legacy.leads.push(custom);
  delete legacy.foodDemoVersion;
  delete legacy.foodSeedVersion;
  delete legacy.foodScenarioVersion;

  const { request, login, load } = await browserFixture(t, legacy);
  const session = await request('/api/session');
  assert.equal(session.user.id, 'biz-visa');
  assert.ok(session.profiles.some((profile) => profile.id === 'biz-food'));
  const visa = await request('/api/dashboard');
  assert.equal(visa.leads.find((lead) => lead.id === custom.id).comment, custom.comment);
  assert.equal(visa.leads.find((lead) => lead.id === custom.id).status, 'contacted');
  await login('biz-food');
  const food = await request('/api/dashboard');
  assert.equal(food.businesses[0].name, 'шMargaret');
  assert.equal(food.offers.find((offer) => offer.id === 'offer-dinner').commission, 75000);
  assert.equal(food.leads.length, 3);
  const edited = food.leads.find((lead) => lead.id === 'BC-1051');
  await request(`/api/leads/${edited.id}`, 'PATCH', { status: 'contacted' });
  const reloaded = await load();
  const restored = await reloaded.request('/api/dashboard');
  assert.equal(restored.leads.length, 3, 'reload does not duplicate food examples');
  assert.equal(restored.leads.find((lead) => lead.id === edited.id).status, 'contacted');
});

test('restaurant referral produces a food lead and commission only after a paid visit', async (t) => {
  const { request, login } = await browserFixture(t);
  const link = seed.links.find((item) => item.id === 'link-leo-dinner');
  assert.ok(link, 'food referral is present in the published seed');
  const offer = await request(`/api/referrals/${link.code}`);
  assert.equal(offer.business.name, 'шMargaret');
  assert.equal(offer.offer.commission, 75000);
  assert.equal(offer.offer.title, 'Ужин на двоих в шMargaret');
  const created = await request(`/api/referrals/${link.code}/leads`, 'POST', {
    clientName: 'Гость ресторана', contact: 'food-guest@example.test', comment: 'Столик на двоих', consent: true, requestId: randomUUID(), commission: 1, businessId: 'business-visa',
  });
  await login('biz-food');
  let state = await request('/api/dashboard');
  let lead = state.leads.find((item) => item.id === created.lead.id);
  assert.equal(lead.businessId, 'business-food');
  assert.equal(lead.offerId, 'offer-dinner');
  assert.equal(lead.partnerId, 'partner-leo');
  assert.equal(lead.commission, 75000);
  assert.equal(lead.commissionStatus, 'pending');
  await request(`/api/leads/${lead.id}`, 'PATCH', { status: 'paid', saleAmount: 680000 });
  state = await request('/api/dashboard');
  lead = state.leads.find((item) => item.id === created.lead.id);
  assert.equal(lead.saleAmount, 680000);
  assert.equal(lead.commissionStatus, 'approved');
});

test('mixed overview restores all examples once and keeps saved work and later account choices', async (t) => {
  const legacy = structuredClone(seed);
  delete legacy.overviewVersion;
  legacy.currentProfileId = 'biz-food';
  const custom = {
    ...legacy.leads.find((lead) => lead.businessId === 'business-visa'),
    id: 'BC-MIXED-SAVED',
    contact: 'mixed-overview@example.test',
    comment: 'Сохранённая заявка пользователя',
    status: 'contacted',
  };
  legacy.leads.push(custom);
  const savedPayouts = structuredClone(legacy.payouts);
  const { request, login, load } = await browserFixture(t, legacy);

  const session = await request('/api/session');
  assert.equal(session.user.id, 'admin');
  assert.equal(session.user.name, 'Лео');
  assert.equal(session.user.avatar, 'leo-avatar.jpg');
  const overview = await request('/api/dashboard');
  assert.deepEqual(new Set(overview.businesses.map((business) => business.id)), new Set(['business-visa', 'business-cowork', 'business-food']));
  assert.equal(overview.offers.length, 4);
  assert.equal(overview.leads.length, seed.leads.length + 1);
  assert.deepEqual(new Set(overview.leads.map((lead) => lead.businessId)), new Set(['business-visa', 'business-cowork', 'business-food']));
  assert.deepEqual(overview.leads.find((lead) => lead.id === custom.id), custom);
  assert.deepEqual(overview.payouts, savedPayouts);

  await login('biz-visa');
  const reloaded = await load();
  assert.equal((await reloaded.request('/api/session')).user.id, 'biz-visa', 'manual account selection must survive after the one-time overview update');
  const scoped = await reloaded.request('/api/dashboard');
  assert.ok(scoped.leads.every((lead) => lead.businessId === 'business-visa'));
  assert.equal(scoped.leads.find((lead) => lead.id === custom.id).comment, custom.comment);
  assert.ok(!scoped.leads.some((lead) => lead.businessId === 'business-food'));
});
