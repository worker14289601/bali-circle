/**
 * Browser-only adapter for the shareable GitHub Pages demonstration.
 * All records are fictional and local to this browser. These role checks are
 * interaction examples, not an authorization boundary for real customer data.
 */
import seed from './demo-seed.json';
import type { Activity, Business, DashboardData, Lead, LeadStatus, Offer, Payout, ReferralLink, User } from './types';

const STORAGE_KEY = 'bali-circle-demo-v1';
type DemoActivity = Activity & { businessId: string; partnerId: string | null };
interface DemoState {
  version: 1;
  foodScenarioVersion?: 1;
  currentProfileId: string | null;
  profiles: User[];
  businesses: Business[];
  offers: Offer[];
  links: ReferralLink[];
  leads: Lead[];
  payouts: Payout[];
  activity: DemoActivity[];
  requestIds: Record<string, string>;
  visitedCodes: string[];
}

type Fields = Record<string, unknown>;
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const referralCode = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => byte.toString(16).padStart(2, '0')).join('');
const clone = <T,>(value: T): T => structuredClone(value);
const initial = () => clone(seed) as unknown as DemoState;
const clean = (value: unknown, min: number, max: number, label: string): string => {
  if (typeof value !== 'string') throw new Error(`Укажите ${label}.`);
  const text = value.trim();
  if (text.length < min || text.length > max) throw new Error(`${label}: от ${min} до ${max} символов.`);
  return text;
};
const amount = (value: unknown, label: string, max = 1_000_000_000_000): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > max) throw new Error(`Укажите корректную сумму: ${label}.`);
  return value;
};
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^\+?[\d\s()-]{7,25}$/;
const normalizeContact = (contact: string) => emailPattern.test(contact) ? contact.toLowerCase() : contact.replace(/\D/g, '');

function save(state: DemoState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { throw new Error('Не удалось сохранить демо. Разрешите хранение данных в браузере и повторите действие.'); }
}

function read(): DemoState {
  let raw: string | null;
  try { raw = localStorage.getItem(STORAGE_KEY); }
  catch { throw new Error('Браузер блокирует хранение данных. Разрешите его для этого демо.'); }
  if (!raw) { const state = initial(); save(state); return state; }
  let state: DemoState;
  try {
    state = JSON.parse(raw) as DemoState;
    if (state.version !== 1 || !Array.isArray(state.profiles) || !Array.isArray(state.businesses)
      || !Array.isArray(state.offers) || !Array.isArray(state.links) || !Array.isArray(state.leads)
      || !Array.isArray(state.payouts) || !Array.isArray(state.activity) || !Array.isArray(state.visitedCodes)
      || !state.requestIds || typeof state.requestIds !== 'object') throw new Error();
  } catch {
    throw new Error('Сохранённые данные демо повреждены. Сбросьте демо, чтобы вернуться к исходным примерам.');
  }
  // Published profile and URL changes must preserve saved work and account selection.
  state.profiles = clone(seed.profiles) as User[];
  let addedFoodScenario = false;
  if (state.foodScenarioVersion !== 1) {
    const appendMissing = <T extends { id: string }>(existing: T[], additions: T[]) => {
      const ids = new Set(existing.map((entry) => entry.id));
      for (const entry of additions) if (!ids.has(entry.id)) existing.push(clone(entry));
    };
    const foodOffers = seed.offers.filter((offer) => offer.businessId === 'business-food');
    const foodOfferIds = new Set(foodOffers.map((offer) => offer.id));
    appendMissing(state.businesses, seed.businesses.filter((business) => business.id === 'business-food'));
    appendMissing(state.offers, foodOffers as Offer[]);
    appendMissing(state.links, seed.links.filter((link) => foodOfferIds.has(link.offerId)));
    appendMissing(state.leads, seed.leads.filter((lead) => lead.businessId === 'business-food') as Lead[]);
    appendMissing(state.activity, seed.activity.filter((event) => event.businessId === 'business-food') as DemoActivity[]);
    state.foodScenarioVersion = 1;
    addedFoodScenario = true;
  }
  const codes = new Set(state.links.map((link) => link.code));
  const replacements = new Map<string, string>();
  for (const link of state.links) {
    if (/^[a-f0-9]{24}$/.test(link.code)) continue;
    let code = seed.links.find((entry) => entry.id === link.id)?.code;
    if (!code || codes.has(code)) {
      do { code = referralCode(); } while (codes.has(code));
    }
    replacements.set(link.code, code);
    codes.delete(link.code);
    codes.add(code);
    link.code = code;
  }
  if (replacements.size || addedFoodScenario) {
    state.visitedCodes = state.visitedCodes.map((code) => replacements.get(code) || code);
    save(state);
  }
  return state;
}

export function resetDemo() {
  try { localStorage.removeItem(STORAGE_KEY); }
  catch { throw new Error('Не удалось сбросить данные демо. Проверьте настройки браузера.'); }
}

function bodyOf(options: RequestInit): Fields {
  if (options.body === undefined || options.body === null || options.body === '') return {};
  if (typeof options.body !== 'string') throw new Error('Используйте JSON для этого запроса.');
  try {
    const value: unknown = JSON.parse(options.body);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Fields;
  } catch { throw new Error('Некорректный JSON.'); }
}

function requireUser(state: DemoState): User {
  const user = state.profiles.find((profile) => profile.id === state.currentProfileId);
  if (!user) throw new Error('Войдите в демо-кабинет.');
  return user;
}

function requireBusiness(state: DemoState): User {
  const user = requireUser(state);
  if (user.role === 'partner') throw new Error('Это действие доступно бизнесу или администратору.');
  return user;
}

function businessIdFor(state: DemoState, user: User, fields: Fields): string {
  const businessId = user.role === 'business' ? user.businessId : fields.businessId;
  if (typeof businessId !== 'string' || !state.businesses.some((business) => business.id === businessId)) throw new Error('Выберите бизнес.');
  return businessId;
}

function addActivity(state: DemoState, event: Omit<DemoActivity, 'id' | 'createdAt'>, createdAt = now()) {
  state.activity.unshift({ id: id(), ...event, createdAt });
}

function visibleTo(user: User, row: { businessId?: string; partnerId?: string | null }) {
  return user.role === 'admin' || (user.role === 'business' ? row.businessId === user.businessId : row.partnerId === user.id);
}

function safeLead(lead: Lead, user: User): Lead {
  if (user.role !== 'partner') return { ...lead };
  return { ...lead, clientName: lead.clientName.split(/\s+/)[0], contact: '', comment: '' };
}

function dashboard(state: DemoState, user: User): DashboardData {
  const businesses = user.role === 'business' ? state.businesses.filter((business) => business.id === user.businessId) : state.businesses;
  const offers = user.role === 'business' ? state.offers.filter((offer) => offer.businessId === user.businessId) : state.offers;
  const offerIds = new Set(offers.map((offer) => offer.id));
  const links = user.role === 'business' ? state.links.filter((link) => offerIds.has(link.offerId))
    : user.role === 'partner' ? state.links.filter((link) => link.partnerId === user.id) : state.links;
  return {
    user,
    businesses,
    offers,
    links,
    leads: state.leads.filter((lead) => visibleTo(user, lead)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((lead) => safeLead(lead, user)),
    payouts: state.payouts.filter((payout) => visibleTo(user, payout)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    activity: state.activity.filter((event) => visibleTo(user, event)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 60)
      .map(({ businessId: _businessId, partnerId: _partnerId, ...event }) => event),
  };
}

function referral(state: DemoState, code: string) {
  if (!code || code.length > 100) throw new Error('Ссылка не найдена.');
  const link = state.links.find((item) => item.code === code);
  if (!link) throw new Error('Ссылка не найдена.');
  const offer = state.offers.find((item) => item.id === link.offerId && item.active);
  if (!offer) throw new Error('Предложение больше не доступно.');
  const business = state.businesses.find((item) => item.id === offer.businessId);
  if (!business) throw new Error('Бизнес не найден.');
  return { link, offer, business };
}

const publicLead = ({ id: leadId, status, createdAt }: Lead) => ({ id: leadId, status, createdAt });

export async function demoRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  // Every call loads the current snapshot. Mutations run synchronously until the
  // localStorage write, so requests from this tab cannot interleave mid-update.
  const state = read();
  const method = (options.method || 'GET').toUpperCase();
  const route = path.split('?')[0].replace(/\/$/, '');
  const fields = bodyOf(options);
  const result = (value: unknown) => clone(value) as T;
  const commit = (value: unknown) => { save(state); return result(value); };

  if (route === '/api/session' && method === 'GET') {
    return result({ user: state.profiles.find((profile) => profile.id === state.currentProfileId) || null, profiles: state.profiles, demo: true });
  }
  if (route === '/api/demo-login' && method === 'POST') {
    const user = state.profiles.find((profile) => profile.id === fields.profileId);
    if (!user) throw new Error('Выберите демо-профиль.');
    state.currentProfileId = user.id;
    return commit({ user });
  }
  if (route === '/api/logout' && method === 'POST') {
    state.currentProfileId = null;
    return commit({ ok: true });
  }
  if (route === '/api/dashboard' && method === 'GET') return result(dashboard(state, requireUser(state)));

  if (route === '/api/offers' && method === 'POST') {
    const user = requireBusiness(state);
    const businessId = businessIdFor(state, user, fields);
    const offer: Offer = {
      id: `offer-${id()}`, businessId,
      title: clean(fields.title, 3, 100, 'название'),
      description: clean(fields.description, 10, 1000, 'описание'),
      commission: amount(fields.commission, 'комиссия', 100_000_000), currency: 'IDR', active: true,
    };
    state.offers.push(offer);
    addActivity(state, { businessId, partnerId: null, leadId: null, actor: user.name, message: `Создано предложение «${offer.title}»` });
    return commit({ offer });
  }

  if (route === '/api/links' && method === 'POST') {
    const user = requireUser(state);
    const offer = state.offers.find((item) => item.id === fields.offerId && item.active);
    if (!offer || (user.role === 'business' && offer.businessId !== user.businessId)) throw new Error('Предложение не найдено.');
    const partner = user.role === 'partner' ? user : state.profiles.find((profile) => profile.id === 'partner-leo')!;
    const existing = state.links.find((link) => link.offerId === offer.id && link.partnerId === partner.id);
    if (existing) return result({ link: existing });
    const link: ReferralLink = { id: id(), offerId: offer.id, partnerId: partner.id, partnerName: partner.name, code: referralCode(), clicks: 0 };
    state.links.push(link);
    addActivity(state, { businessId: offer.businessId, partnerId: partner.id, leadId: null, actor: user.name, message: `Создана партнёрская ссылка для «${offer.title}»` });
    return commit({ link });
  }

  const publicRoute = route.match(/^\/api\/referrals\/([^/]+)(?:\/(visit|leads))?$/);
  if (publicRoute) {
    let code: string;
    try { code = decodeURIComponent(publicRoute[1]); } catch { throw new Error('Ссылка не найдена.'); }
    const { link, offer, business } = referral(state, code);
    const action = publicRoute[2];
    if (!action && method === 'GET') return result({ offer, business, partnerName: link.partnerName, code: link.code });
    if (action === 'visit' && method === 'POST') {
      if (!state.visitedCodes.includes(link.code)) { state.visitedCodes.push(link.code); link.clicks += 1; }
      return commit({ ok: true });
    }
    if (action === 'leads' && method === 'POST') {
      const clientName = clean(fields.clientName, 2, 80, 'имя');
      const contact = clean(fields.contact, 5, 120, 'WhatsApp или email');
      if (!emailPattern.test(contact) && !phonePattern.test(contact)) throw new Error('Укажите email или телефон с кодом страны.');
      if (fields.consent !== true) throw new Error('Подтвердите согласие на передачу контакта бизнесу.');
      const comment = fields.comment === undefined ? '' : clean(fields.comment, 0, 500, 'комментарий');
      const requestId = clean(fields.requestId, 8, 100, 'идентификатор заявки');
      if (!/^[\w-]+$/.test(requestId)) throw new Error('Некорректный идентификатор заявки.');
      const normalizedContact = normalizeContact(contact);
      const priorId = Object.prototype.hasOwnProperty.call(state.requestIds, requestId) ? state.requestIds[requestId] : undefined;
      const prior = priorId ? state.leads.find((lead) => lead.id === priorId) : undefined;
      if (prior) {
        if (prior.offerId !== offer.id || prior.partnerId !== link.partnerId || normalizeContact(prior.contact || '') !== normalizedContact) throw new Error('Идентификатор заявки уже использован.');
        return result({ lead: publicLead(prior), duplicate: true });
      }
      if (state.leads.some((lead) => lead.offerId === offer.id && lead.status !== 'cancelled' && normalizeContact(lead.contact || '') === normalizedContact)) {
        throw new Error('Заявка с этим контактом уже есть. Свяжитесь с бизнесом, чтобы уточнить её статус.');
      }
      const createdAt = now();
      const lead: Lead = {
        id: `BC-${id().slice(0, 8).toUpperCase()}`, offerId: offer.id, businessId: offer.businessId,
        partnerId: link.partnerId, partnerName: link.partnerName, clientName, contact, comment,
        status: 'new', saleAmount: null, commission: offer.commission, currency: 'IDR', commissionStatus: 'pending', createdAt, updatedAt: createdAt,
      };
      state.leads.unshift(lead);
      Object.defineProperty(state.requestIds, requestId, { value: lead.id, writable: true, enumerable: true, configurable: true });
      addActivity(state, { businessId: lead.businessId, partnerId: lead.partnerId, leadId: lead.id, actor: lead.partnerName, message: `Новая заявка ${lead.id}` }, createdAt);
      return commit({ lead: publicLead(lead) });
    }
  }

  const leadRoute = route.match(/^\/api\/leads\/([^/]+)$/);
  if (leadRoute && method === 'PATCH') {
    const user = requireBusiness(state);
    const lead = state.leads.find((item) => item.id === decodeURIComponent(leadRoute[1]));
    if (!lead || (user.role === 'business' && lead.businessId !== user.businessId)) throw new Error('Заявка не найдена.');
    const status = fields.status as LeadStatus;
    const transitions: Record<LeadStatus, LeadStatus[]> = { new: ['contacted', 'paid', 'cancelled'], contacted: ['paid', 'cancelled'], paid: ['cancelled'], cancelled: [] };
    if (!transitions[lead.status]?.includes(status)) throw new Error('Этот переход статуса недоступен. Обновите список заявок.');
    if (lead.commissionStatus === 'paid') throw new Error('Комиссия уже выплачена. Изменение требует отдельной сверки.');
    const saleAmount = status === 'paid' ? amount(fields.saleAmount, 'сумма продажи') : lead.saleAmount;
    const reason = status === 'cancelled' ? clean(fields.reason, 3, 300, 'причину отмены') : null;
    lead.status = status;
    lead.saleAmount = saleAmount;
    lead.commissionStatus = status === 'paid' ? 'approved' : status === 'cancelled' ? 'void' : lead.commissionStatus;
    lead.updatedAt = now();
    const message = status === 'paid' ? `Подтверждена оплата по заявке ${lead.id}` : status === 'cancelled' ? `Заявка ${lead.id} отменена: ${reason}` : `Заявка ${lead.id}: связались с клиентом`;
    addActivity(state, { businessId: lead.businessId, partnerId: lead.partnerId, leadId: lead.id, actor: user.name, message }, lead.updatedAt);
    return commit({ lead: safeLead(lead, user) });
  }

  if (route === '/api/payouts' && method === 'POST') {
    const user = requireBusiness(state);
    const businessId = businessIdFor(state, user, fields);
    const partner = state.profiles.find((profile) => profile.id === fields.partnerId && profile.role === 'partner');
    if (!partner) throw new Error('Выберите партнёра.');
    const reference = clean(fields.reference, 3, 120, 'номер или комментарий перевода');
    const expectedAmount = amount(fields.expectedAmount, 'ожидаемая сумма выплаты');
    const leads = state.leads.filter((lead) => lead.businessId === businessId && lead.partnerId === partner.id && lead.status === 'paid' && lead.commissionStatus === 'approved');
    if (!leads.length) throw new Error('Нет подтверждённых начислений для выплаты.');
    const total = leads.reduce((sum, lead) => sum + lead.commission, 0);
    if (!Number.isSafeInteger(total) || total !== expectedAmount) throw new Error('Сумма начислений изменилась. Обновите список и сверьте сумму перевода перед записью выплаты.');
    const payout: Payout = { id: id(), businessId, partnerId: partner.id, partnerName: partner.name, amount: total, currency: 'IDR', reference, createdAt: now() };
    state.payouts.unshift(payout);
    for (const lead of leads) { lead.commissionStatus = 'paid'; lead.updatedAt = payout.createdAt; }
    addActivity(state, { businessId, partnerId: partner.id, leadId: null, actor: user.name, message: `Зафиксирована выплата ${partner.name}: ${total.toLocaleString('ru-RU')} IDR · ${reference}` }, payout.createdAt);
    return commit({ payout });
  }

  throw new Error('Такой API-маршрут не найден.');
}
