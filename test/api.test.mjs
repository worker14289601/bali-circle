import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createApp } from '../server/index.mjs';

const seed = JSON.parse(readFileSync(new URL('../src/demo-seed.json', import.meta.url), 'utf8'));
const visaCode = seed.links.find((link) => link.id === 'link-leo-visa').code;


async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'bali-circle-api-'));
  const dbPath = path.join(directory, 'test.sqlite');
  const instances = [];
  async function open() {
    const app = await createApp({ dbPath, serveFrontend: false });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    instances.push({ app, server });
    async function request(url, { method = 'GET', cookie, body, origin: requestOrigin = origin } = {}) {
      const headers = {};
      if (cookie) headers.cookie = cookie;
      if (method !== 'GET') headers.origin = requestOrigin;
      if (body !== undefined) headers['content-type'] = 'application/json';
      const response = await fetch(`${origin}${url}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      return { status: response.status, data, text, cookie: response.headers.get('set-cookie')?.split(';')[0] };
    }
    async function login(profileId) {
      const result = await request('/api/demo-login', { method: 'POST', body: { profileId } });
      assert.equal(result.status, 200, JSON.stringify(result.data));
      assert.ok(result.cookie, 'login issues a session cookie');
      return result.cookie;
    }
    return { app, server, request, login };
  }
  t.after(async () => {
    for (const { app, server } of instances.reverse()) {
      if (server.listening) await new Promise((resolve) => server.close(resolve));
      if (typeof app.locals.close === 'function') await app.locals.close();
      else if (typeof app.locals.db?.close === 'function') app.locals.db.close();
    }
    await rm(directory, { recursive: true, force: true });
  });
  return { ...await open(), open };
}

function leadBody(overrides = {}) {
  return {
    clientName: 'Тестовый Клиент',
    contact: `client-${randomUUID()}@example.test`,
    comment: 'Проверка реферальной заявки',
    consent: true,
    requestId: randomUUID(),
    ...overrides,
  };
}

async function submit(request, overrides) {
  const result = await request(`/api/referrals/${visaCode}/leads`, { method: 'POST', body: leadBody(overrides) });
  assert.ok([200, 201].includes(result.status), JSON.stringify(result.data));
  assert.ok(result.data.lead?.id);
  return result.data.lead;
}

async function dashboard(request, cookie) {
  const result = await request('/api/dashboard', { cookie });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data;
}

test('public referral is available, private records require a session, cross-site writes fail', async (t) => {
  const { request } = await fixture(t);
  const publicOffer = await request(`/api/referrals/${visaCode}`);
  assert.equal(publicOffer.status, 200);
  assert.ok(publicOffer.data.offer.title);
  assert.ok(publicOffer.data.business.name);
  assert.equal((await request('/api/dashboard')).status, 401);
  assert.equal((await request('/api/export.csv')).status, 401);
  const crossSite = await request('/api/demo-login', {
    method: 'POST', origin: 'https://unrelated.example', body: { profileId: 'admin' },
  });
  assert.equal(crossSite.status, 403);
});

test('partner sees own referrals without client contacts and cannot approve sales or payouts', async (t) => {
  const { request, login } = await fixture(t);
  const cookie = await login('partner-leo');
  const state = await dashboard(request, cookie);
  assert.ok(state.leads.length > 0);
  assert.ok(state.leads.every((lead) => lead.partnerId === 'partner-leo'));
  assert.ok(state.leads.every((lead) => !lead.contact), 'partner receives no contact details');
  const lead = state.leads.find((item) => item.status === 'new') ?? state.leads[0];
  assert.equal((await request(`/api/leads/${lead.id}`, {
    method: 'PATCH', cookie, body: { status: 'paid', saleAmount: 1000000 },
  })).status, 403);
  assert.equal((await request('/api/payouts', {
    method: 'POST', cookie, body: { partnerId: 'partner-leo', reference: 'test-transfer', expectedAmount: 150000 },
  })).status, 403);
});

test('business records are isolated from another business', async (t) => {
  const { request, login } = await fixture(t);
  const visaCookie = await login('biz-visa');
  const coworkCookie = await login('biz-cowork');
  const visa = await dashboard(request, visaCookie);
  const cowork = await dashboard(request, coworkCookie);
  assert.ok(visa.leads.length > 0);
  assert.ok(cowork.leads.length > 0);
  assert.ok(visa.leads.every((lead) => lead.businessId === visa.user.businessId));
  assert.ok(cowork.leads.every((lead) => lead.businessId === cowork.user.businessId));
  assert.notEqual(visa.user.businessId, cowork.user.businessId);
  const forbidden = await request(`/api/leads/${visa.leads[0].id}`, {
    method: 'PATCH', cookie: coworkCookie, body: { status: 'paid', saleAmount: 1000000 },
  });
  assert.ok([403, 404].includes(forbidden.status));
  assert.ok(cowork.payouts.every((payout) => payout.businessId === cowork.user.businessId));
});

test('lead source and commission come from the referral, and repeated submits create one lead', async (t) => {
  const { request, login } = await fixture(t);
  const cookie = await login('biz-visa');
  const offer = (await request(`/api/referrals/${visaCode}`)).data.offer;
  const payload = leadBody({ commission: 999999999, partnerId: 'attacker', businessId: 'attacker' });
  const first = await request(`/api/referrals/${visaCode}/leads`, { method: 'POST', body: payload });
  assert.ok([200, 201].includes(first.status), JSON.stringify(first.data));
  const repeated = await request(`/api/referrals/${visaCode}/leads`, { method: 'POST', body: payload });
  assert.ok([200, 201, 409].includes(repeated.status));
  const repeatedContact = await request(`/api/referrals/${visaCode}/leads`, {
    method: 'POST', body: { ...payload, requestId: randomUUID() },
  });
  assert.equal(repeatedContact.status, 409, 'a new request ID must not bypass duplicate contact protection');
  const state = await dashboard(request, cookie);
  const matches = state.leads.filter((lead) => lead.contact === payload.contact);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].partnerId, 'partner-leo');
  assert.equal(matches[0].offerId, offer.id);
  assert.equal(matches[0].commission, offer.commission);
  assert.equal(matches[0].commissionStatus, 'pending');
  if (repeated.data.lead) assert.equal(repeated.data.lead.id, first.data.lead.id);
});

test('request IDs cannot be reused to retrieve an unrelated client lead', async (t) => {
  const { request } = await fixture(t);
  const payload = leadBody();
  const first = await request(`/api/referrals/${visaCode}/leads`, { method: 'POST', body: payload });
  assert.ok([200, 201].includes(first.status));
  const second = await request(`/api/referrals/${visaCode}/leads`, {
    method: 'POST', body: { ...payload, contact: 'different-client@example.test', clientName: 'Другой Клиент' },
  });
  assert.ok([400, 409].includes(second.status), 'conflicting idempotency payload must not silently reuse another lead');
});

test('lead creation rejects missing consent and invalid required fields', async (t) => {
  const { request } = await fixture(t);
  for (const changes of [{ consent: false }, { clientName: '' }, { contact: '' }, { requestId: '' }]) {
    const result = await request(`/api/referrals/${visaCode}/leads`, { method: 'POST', body: leadBody(changes) });
    assert.equal(result.status, 400, JSON.stringify({ changes, response: result.data }));
  }
});

test('a paid lead requires a valid amount, can only be approved once, and is audited', async (t) => {
  const { request, login } = await fixture(t);
  const cookie = await login('biz-visa');
  const lead = await submit(request);
  for (const saleAmount of [0, -1, '1000000', null]) {
    assert.equal((await request(`/api/leads/${lead.id}`, {
      method: 'PATCH', cookie, body: { status: 'paid', saleAmount },
    })).status, 400);
  }
  const payment = { method: 'PATCH', cookie, body: { status: 'paid', saleAmount: 2000000 } };
  const results = await Promise.all([
    request(`/api/leads/${lead.id}`, payment), request(`/api/leads/${lead.id}`, payment),
  ]);
  assert.equal(results.filter((result) => result.status === 200).length, 1);
  assert.ok(results.some((result) => result.status === 409));
  const state = await dashboard(request, cookie);
  const updated = state.leads.find((item) => item.id === lead.id);
  assert.equal(updated.status, 'paid');
  assert.equal(updated.commissionStatus, 'approved');
  assert.equal(updated.saleAmount, 2000000);
  assert.ok(state.activity.some((event) => event.leadId === lead.id), 'status changes create audit events');
});

test('cancellation requires a reason and removes unpaid commission from payout eligibility', async (t) => {
  const { request, login } = await fixture(t);
  const cookie = await login('biz-visa');
  const lead = await submit(request);
  assert.equal((await request(`/api/leads/${lead.id}`, {
    method: 'PATCH', cookie, body: { status: 'paid', saleAmount: 2000000 },
  })).status, 200);
  assert.equal((await request(`/api/leads/${lead.id}`, {
    method: 'PATCH', cookie, body: { status: 'cancelled' },
  })).status, 400);
  assert.equal((await request(`/api/leads/${lead.id}`, {
    method: 'PATCH', cookie, body: { status: 'cancelled', reason: 'Клиенту вернули оплату' },
  })).status, 200);
  const state = await dashboard(request, cookie);
  const cancelled = state.leads.find((item) => item.id === lead.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.commissionStatus, 'void');
  const revive = await request(`/api/leads/${lead.id}`, {
    method: 'PATCH', cookie, body: { status: 'paid', saleAmount: 2000000 },
  });
  assert.equal(revive.status, 409);
});

test('manual payout is atomic, cannot be repeated, and settled sales cannot be cancelled', async (t) => {
  const { request, login } = await fixture(t);
  const cookie = await login('biz-visa');
  const lead = await submit(request);
  await request(`/api/leads/${lead.id}`, { method: 'PATCH', cookie, body: { status: 'paid', saleAmount: 2000000 } });
  const before = await dashboard(request, cookie);
  const eligible = before.leads.filter((item) => item.partnerId === 'partner-leo' && item.commissionStatus === 'approved');
  const expected = eligible.reduce((sum, item) => sum + item.commission, 0);
  assert.ok(expected > 0);
  assert.equal((await request('/api/payouts', {
    method: 'POST', cookie, body: { partnerId: 'partner-leo', reference: '', expectedAmount: expected },
  })).status, 400, 'manual payout needs an explicit transfer reference');
  const payoutRequest = { method: 'POST', cookie, body: { partnerId: 'partner-leo', reference: 'BANK-TEST-001', expectedAmount: expected } };
  const results = await Promise.all([request('/api/payouts', payoutRequest), request('/api/payouts', payoutRequest)]);
  const success = results.filter((result) => [200, 201].includes(result.status));
  assert.equal(success.length, 1, JSON.stringify(results));
  assert.equal(success[0].data.payout.amount, expected);
  assert.ok(results.some((result) => result.status === 409));
  const after = await dashboard(request, cookie);
  assert.equal(after.payouts.length, before.payouts.length + 1);
  assert.equal(after.leads.filter((item) => item.partnerId === 'partner-leo' && item.commissionStatus === 'approved').length, 0);
  assert.equal(after.leads.find((item) => item.id === lead.id).commissionStatus, 'paid');
  assert.equal((await request(`/api/leads/${lead.id}`, {
    method: 'PATCH', cookie, body: { status: 'cancelled', reason: 'Ошибочная отмена после выплаты' },
  })).status, 409);
});

test('a stale payout amount cannot settle commissions added after the confirmation view opened', async (t) => {
  const { request, login } = await fixture(t);
  const cookie = await login('biz-visa');
  const firstLead = await submit(request);
  assert.equal((await request(`/api/leads/${firstLead.id}`, {
    method: 'PATCH', cookie, body: { status: 'paid', saleAmount: 2000000 },
  })).status, 200);
  const snapshot = await dashboard(request, cookie);
  const eligibleForLeo = (state) => state.leads.filter((lead) => lead.partnerId === 'partner-leo' && lead.commissionStatus === 'approved');
  const shownAmount = eligibleForLeo(snapshot).reduce((sum, lead) => sum + lead.commission, 0);

  // A second sale is confirmed while the user is looking at the old payout modal.
  const laterLead = await submit(request);
  assert.equal((await request(`/api/leads/${laterLead.id}`, {
    method: 'PATCH', cookie, body: { status: 'paid', saleAmount: 2000000 },
  })).status, 200);
  const beforeAttempt = await dashboard(request, cookie);
  const latestEligible = eligibleForLeo(beforeAttempt);
  const currentAmount = latestEligible.reduce((sum, lead) => sum + lead.commission, 0);
  assert.ok(currentAmount > shownAmount);

  const stale = await request('/api/payouts', {
    method: 'POST', cookie,
    body: { partnerId: 'partner-leo', reference: 'BANK-STALE-001', expectedAmount: shownAmount },
  });
  assert.equal(stale.status, 409);
  const afterRejected = await dashboard(request, cookie);
  assert.equal(afterRejected.payouts.length, beforeAttempt.payouts.length, 'rejected payout must not create a ledger record');
  for (const lead of latestEligible) {
    assert.equal(afterRejected.leads.find((item) => item.id === lead.id).commissionStatus, 'approved', 'rejected payout must leave every commission unchanged');
  }

  const confirmed = await request('/api/payouts', {
    method: 'POST', cookie,
    body: { partnerId: 'partner-leo', reference: 'BANK-FRESH-001', expectedAmount: currentAmount },
  });
  assert.ok([200, 201].includes(confirmed.status), JSON.stringify(confirmed.data));
  assert.equal(confirmed.data.payout.amount, currentAmount);
  const afterConfirmed = await dashboard(request, cookie);
  assert.equal(afterConfirmed.payouts.length, beforeAttempt.payouts.length + 1);
  for (const lead of latestEligible) {
    assert.equal(afterConfirmed.leads.find((item) => item.id === lead.id).commissionStatus, 'paid');
  }
});

test('submitted leads and status changes survive reopening the application database', async (t) => {
  const first = await fixture(t);
  const lead = await submit(first.request);
  const cookie = await first.login('biz-visa');
  assert.equal((await first.request(`/api/leads/${lead.id}`, {
    method: 'PATCH', cookie, body: { status: 'contacted' },
  })).status, 200);
  await new Promise((resolve) => first.server.close(resolve));
  const reopened = await first.open();
  const reopenedCookie = await reopened.login('biz-visa');
  const state = await dashboard(reopened.request, reopenedCookie);
  assert.equal(state.leads.find((item) => item.id === lead.id).status, 'contacted');
});

test('partner CSV exports preserve role redaction', async (t) => {
  const { request, login } = await fixture(t);
  const businessCookie = await login('biz-visa');
  const partnerCookie = await login('partner-leo');
  const business = await dashboard(request, businessCookie);
  const partnerExport = await request('/api/export.csv', { cookie: partnerCookie });
  assert.equal(partnerExport.status, 200);
  for (const lead of business.leads.filter((item) => item.contact)) {
    assert.ok(!partnerExport.text.includes(lead.contact), 'export must not expose contacts hidden in the dashboard');
  }
});

test('referral URLs use opaque random codes and an existing offer-partner pair keeps its code', async (t) => {
  const { request, login } = await fixture(t);
  const cookie = await login('biz-visa');
  const before = await dashboard(request, cookie);
  assert.ok(before.links.every((link) => /^[a-f0-9]{24}$/.test(link.code)));
  const offerResponse = await request('/api/offers', {
    method: 'POST', cookie,
    body: { title: 'Проверка случайной ссылки', description: 'Предложение для проверки независимого кода ссылки.', commission: 120000 },
  });
  assert.equal(offerResponse.status, 201);
  const body = { offerId: offerResponse.data.offer.id };
  const first = await request('/api/links', { method: 'POST', cookie, body });
  assert.equal(first.status, 201);
  assert.match(first.data.link.code, /^[a-f0-9]{24}$/);
  assert.ok(!before.links.some((link) => link.code === first.data.link.code));
  const repeated = await request('/api/links', { method: 'POST', cookie, body });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.data.link.id, first.data.link.id);
  assert.equal(repeated.data.link.code, first.data.link.code);
  const referral = await request(`/api/referrals/${first.data.link.code}`);
  assert.equal(referral.status, 200);
  assert.equal(referral.data.offer.id, offerResponse.data.offer.id);
  assert.equal(referral.data.partnerName, first.data.link.partnerName);
});

test('reopening a legacy SQLite database replaces named codes without changing referral ownership or records', async (t) => {
  const first = await fixture(t);
  const lead = await submit(first.request);
  const db = first.app.locals.db;
  const legacyCodes = ['leo-visa', 'leo-extension', 'maya-visa', 'leo-cowork'];
  const originalLinks = db.prepare('SELECT * FROM links ORDER BY id').all();
  const beforePayouts = db.prepare('SELECT * FROM payouts ORDER BY id').all();
  const beforeLeadCount = db.prepare('SELECT COUNT(*) AS count FROM leads').get().count;
  const seededById = new Map(seed.links.map((link) => [link.id, link]));
  for (const [index, link] of originalLinks.entries()) {
    db.prepare('UPDATE links SET code=? WHERE id=?').run(legacyCodes[index], link.id);
  }
  db.prepare('INSERT INTO links(id,offerId,partnerId,partnerName,code,clicks) VALUES(?,?,?,?,?,?)')
    .run('legacy-custom-link', 'offer-visa', 'partner-legacy', 'Старый партнёр', 'leo-old-custom', 7);
  await new Promise((resolve) => first.server.close(resolve));

  const reopened = await first.open();
  const cookie = await reopened.login('biz-visa');
  const state = await dashboard(reopened.request, cookie);
  for (const original of originalLinks) {
    const migrated = reopened.app.locals.db.prepare('SELECT * FROM links WHERE id=?').get(original.id);
    assert.equal(migrated.code, seededById.get(original.id).code);
    assert.equal(migrated.partnerId, original.partnerId);
    assert.equal(migrated.offerId, original.offerId);
    assert.equal(migrated.clicks, original.clicks);
  }
  const custom = reopened.app.locals.db.prepare('SELECT * FROM links WHERE id=?').get('legacy-custom-link');
  assert.match(custom.code, /^[a-f0-9]{24}$/);
  assert.equal(custom.partnerId, 'partner-legacy');
  assert.equal(custom.clicks, 7);
  assert.equal(reopened.app.locals.db.prepare('SELECT COUNT(*) AS count FROM leads').get().count, beforeLeadCount);
  assert.equal(state.leads.find((item) => item.id === lead.id).partnerId, 'partner-leo');
  assert.deepEqual(reopened.app.locals.db.prepare('SELECT * FROM payouts ORDER BY id').all(), beforePayouts);

  await new Promise((resolve) => reopened.server.close(resolve));
  const again = await first.open();
  assert.equal(again.app.locals.db.prepare('SELECT code FROM links WHERE id=?').get(custom.id).code, custom.code);
});
