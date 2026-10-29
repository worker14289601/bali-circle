import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
let compiledModule;
let temporaryDirectory;

before(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'bali-circle-demo-test-'));
  compiledModule = path.join(temporaryDirectory, 'demo.mjs');
  await build({
    entryPoints: [path.join(projectRoot, 'src/demo.ts')],
    outfile: compiledModule,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
});

after(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
});

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(String(key)); },
    setItem(key, value) { values.set(String(key), String(value)); },
  };
}

async function fixture(t) {
  const localStorage = memoryStorage();
  const sessionStorage = memoryStorage();
  const replacements = {
    localStorage,
    sessionStorage,
    window: {
      localStorage,
      sessionStorage,
      location: { origin: 'https://example.test', pathname: '/bali-circle/', search: '' },
    },
  };
  const originalDescriptors = Object.fromEntries(Object.keys(replacements).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  t.after(() => {
    for (const key of Object.keys(replacements)) {
      if (originalDescriptors[key]) Object.defineProperty(globalThis, key, originalDescriptors[key]);
      else delete globalThis[key];
    }
  });
  async function load() {
    const module = await import(`${pathToFileURL(compiledModule).href}?instance=${randomUUID()}`);
    const request = (url, method = 'GET', body) => module.demoRequest(url, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const login = (profileId) => request('/api/demo-login', 'POST', { profileId });
    return { module, request, login };
  }
  return { ...await load(), load, localStorage, sessionStorage };
}

function leadPayload(overrides = {}) {
  return {
    clientName: 'Демо Тест',
    contact: `demo-${randomUUID()}@example.test`,
    comment: 'Проверка статической версии',
    consent: true,
    requestId: randomUUID(),
    ...overrides,
  };
}

async function submit(request, overrides) {
  const result = await request('/api/referrals/leo-visa/leads', 'POST', leadPayload(overrides));
  assert.ok(result.lead?.id);
  return result.lead;
}

const approvedForLeo = (state) => state.leads.filter((lead) => lead.partnerId === 'partner-leo' && lead.commissionStatus === 'approved');
const total = (leads) => leads.reduce((sum, lead) => sum + lead.commission, 0);

test('Pages demo: a new referral becomes a paid sale and payout, and survives a module reload', async (t) => {
  const { request, login, load, localStorage } = await fixture(t);
  const referral = await request('/api/referrals/leo-visa');
  const payload = leadPayload({ partnerId: 'forged-partner', businessId: 'forged-business', commission: 1 });
  const created = await request('/api/referrals/leo-visa/leads', 'POST', payload);
  const repeated = await request('/api/referrals/leo-visa/leads', 'POST', payload);
  assert.equal(repeated.lead.id, created.lead.id);
  await login('biz-visa');
  const original = await request('/api/dashboard');
  const lead = original.leads.find((item) => item.id === created.lead.id);
  assert.equal(lead.partnerId, 'partner-leo');
  assert.equal(lead.businessId, original.user.businessId);
  assert.equal(lead.commission, referral.offer.commission);
  assert.equal(lead.status, 'new');
  await request(`/api/leads/${lead.id}`, 'PATCH', { status: 'paid', saleAmount: 2000000 });
  const paid = await request('/api/dashboard');
  const expectedAmount = total(approvedForLeo(paid));
  const payout = await request('/api/payouts', 'POST', { partnerId: 'partner-leo', reference: 'DEMO-TRANSFER-001', expectedAmount });
  assert.equal(payout.payout.amount, expectedAmount);
  await login('partner-leo');
  const partner = await request('/api/dashboard');
  const partnerLead = partner.leads.find((item) => item.id === lead.id);
  assert.equal(partnerLead.commissionStatus, 'paid');
  assert.ok(!partnerLead.contact);
  assert.ok(partner.leads.every((item) => item.partnerId === 'partner-leo'));
  assert.ok(localStorage.getItem('bali-circle-demo-v1'), 'demo persists a versioned state');

  const reloaded = await load();
  await reloaded.login('biz-visa');
  const restored = await reloaded.request('/api/dashboard');
  assert.equal(restored.leads.find((item) => item.id === lead.id).commissionStatus, 'paid');
  assert.ok(restored.payouts.some((item) => item.id === payout.payout.id));
});

test('Pages demo: roles and businesses receive scoped records and partners cannot write sales', async (t) => {
  const { request, login } = await fixture(t);
  await assert.rejects(() => request('/api/dashboard'));
  await login('biz-visa');
  const visa = await request('/api/dashboard');
  assert.ok(visa.leads.every((lead) => lead.businessId === visa.user.businessId));
  await login('biz-cowork');
  const cowork = await request('/api/dashboard');
  assert.notEqual(cowork.user.businessId, visa.user.businessId);
  assert.ok(cowork.leads.every((lead) => lead.businessId === cowork.user.businessId));
  await assert.rejects(() => request(`/api/leads/${visa.leads[0].id}`, 'PATCH', { status: 'paid', saleAmount: 1000000 }));
  await login('partner-leo');
  const partner = await request('/api/dashboard');
  assert.ok(partner.leads.every((lead) => lead.partnerId === 'partner-leo' && !lead.contact));
  await assert.rejects(() => request(`/api/leads/${partner.leads[0].id}`, 'PATCH', { status: 'paid', saleAmount: 1000000 }));
  await assert.rejects(() => request('/api/payouts', 'POST', { partnerId: 'partner-leo', reference: 'ILLEGAL', expectedAmount: 150000 }));
  await request('/api/logout', 'POST', {});
  assert.equal((await request('/api/session')).user, null);
});

test('Pages demo: consent, duplicate contacts and conflicting request IDs are enforced', async (t) => {
  const { request } = await fixture(t);
  for (const changes of [{ consent: false }, { clientName: '' }, { contact: '' }, { requestId: '' }]) {
    await assert.rejects(() => request('/api/referrals/leo-visa/leads', 'POST', leadPayload(changes)));
  }
  const payload = leadPayload();
  const original = await request('/api/referrals/leo-visa/leads', 'POST', payload);
  await assert.rejects(() => request('/api/referrals/leo-visa/leads', 'POST', { ...payload, requestId: randomUUID() }));
  await assert.rejects(() => request('/api/referrals/leo-visa/leads', 'POST', { ...payload, contact: 'different@example.test' }));
  const same = await request('/api/referrals/leo-visa/leads', 'POST', payload);
  assert.equal(same.lead.id, original.lead.id);
});

test('Pages demo: double approvals, closed leads and repeated payouts do not double commissions', async (t) => {
  const { request, login } = await fixture(t);
  const lead = await submit(request);
  await login('biz-visa');
  for (const saleAmount of [0, -1, '1000000', null]) {
    await assert.rejects(() => request(`/api/leads/${lead.id}`, 'PATCH', { status: 'paid', saleAmount }));
  }
  await request(`/api/leads/${lead.id}`, 'PATCH', { status: 'paid', saleAmount: 2000000 });
  await assert.rejects(() => request(`/api/leads/${lead.id}`, 'PATCH', { status: 'paid', saleAmount: 2000000 }));
  const before = await request('/api/dashboard');
  const payload = { partnerId: 'partner-leo', reference: 'ONCE-ONLY-001', expectedAmount: total(approvedForLeo(before)) };
  await request('/api/payouts', 'POST', payload);
  await assert.rejects(() => request('/api/payouts', 'POST', payload));
  await assert.rejects(() => request(`/api/leads/${lead.id}`, 'PATCH', { status: 'cancelled', reason: 'После выплаты' }));
  const after = await request('/api/dashboard');
  assert.equal(after.payouts.length, before.payouts.length + 1);
  assert.equal(after.leads.find((item) => item.id === lead.id).commissionStatus, 'paid');

  const cancelledLead = await submit(request);
  await assert.rejects(() => request(`/api/leads/${cancelledLead.id}`, 'PATCH', { status: 'cancelled' }));
  await request(`/api/leads/${cancelledLead.id}`, 'PATCH', { status: 'cancelled', reason: 'Клиент отменил поездку' });
  await assert.rejects(() => request(`/api/leads/${cancelledLead.id}`, 'PATCH', { status: 'paid', saleAmount: 2000000 }));
  const closed = (await request('/api/dashboard')).leads.find((item) => item.id === cancelledLead.id);
  assert.equal(closed.commissionStatus, 'void');
});

test('Pages demo: a stale expected payout leaves all commissions unchanged until the amount is refreshed', async (t) => {
  const { request, login } = await fixture(t);
  await login('biz-visa');
  const snapshot = await request('/api/dashboard');
  const shownAmount = total(approvedForLeo(snapshot));
  const laterLead = await submit(request);
  await request(`/api/leads/${laterLead.id}`, 'PATCH', { status: 'paid', saleAmount: 2000000 });
  const beforeAttempt = await request('/api/dashboard');
  const eligible = approvedForLeo(beforeAttempt);
  const currentAmount = total(eligible);
  assert.ok(currentAmount > shownAmount);
  await assert.rejects(() => request('/api/payouts', 'POST', { partnerId: 'partner-leo', reference: 'STALE-001', expectedAmount: shownAmount }));
  const rejected = await request('/api/dashboard');
  assert.equal(rejected.payouts.length, beforeAttempt.payouts.length);
  assert.equal(total(approvedForLeo(rejected)), currentAmount);
  for (const lead of eligible) assert.equal(rejected.leads.find((item) => item.id === lead.id).commissionStatus, 'approved');
  const payout = await request('/api/payouts', 'POST', { partnerId: 'partner-leo', reference: 'FRESH-001', expectedAmount: currentAmount });
  assert.equal(payout.payout.amount, currentAmount);
  assert.equal(approvedForLeo(await request('/api/dashboard')).length, 0);
});
