/**
 * Browser-only adapter for the shareable GitHub Pages demonstration.
 * All records are fictional and local to this browser. These role checks are
 * interaction examples, not an authorization boundary for real customer data.
 */
import seed from './demo-seed.json';
import type { Activity, Business, DashboardData, Lead, LeadStatus, NetworkBonus, NetworkInfo, Offer, Payout, ReferralLink, User } from './types';

const STORAGE_KEY = 'bali-circle-demo-v1';
const DAY = 86_400_000;
const NETWORK_BONUS_DAYS = 365;
type DemoActivity = Activity & { businessId: string; partnerId: string | null };
interface NetworkLink { partnerId: string; invitedBy: string; invitedAt: string }
interface DemoState {
  version: 1;
  foodScenarioVersion?: 1;
  overviewVersion?: 1;
  networkVersion?: 1;
  leoStartVersion?: 1;
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
  // Bloggers who joined through an invite, who invited whom, and each blogger's invite code.
  members: User[];
  network: NetworkLink[];
  invites: Record<string, string>;
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
const percent = (value: unknown): number => {
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 50) throw new Error('Сетевой бонус: от 0 до 50%.');
  return value;
};
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^\+?[\d\s()-]{7,25}$/;
const normalizeContact = (contact: string) => emailPattern.test(contact) ? contact.toLowerCase() : contact.replace(/\D/g, '');
const networkBonusAmount = (commission: number, percent: number) => Math.round(commission * percent / 100);
const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0].toUpperCase()).join('');

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
  const addedNetwork = migrateNetwork(state);
  // The demo is made for Leo: browsers that saved another account open his blogger cabinet once.
  const startAsLeo = state.leoStartVersion !== 1;
  if (startAsLeo) { state.currentProfileId = 'partner-leo'; state.leoStartVersion = 1; }
  // Published metadata changes preserve records; this overview migration runs once.
  state.profiles = [...clone(seed.profiles) as User[], ...state.members];
  const showMixedOverview = state.overviewVersion !== 1;
  if (showMixedOverview) {
    state.currentProfileId = 'admin';
    state.overviewVersion = 1;
  }
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
  // Keep demo fixture copy current without changing saved requests or commissions.
  for (const fixture of seed.offers) {
    const offer = state.offers.find(entry => entry.id === fixture.id);
    if (offer) offer.description = fixture.description;
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
  if (replacements.size || addedFoodScenario || showMixedOverview || addedNetwork || startAsLeo) {
    state.visitedCodes = state.visitedCodes.map((code) => replacements.get(code) || code);
    save(state);
  }
  return state;
}

// Adds the blogger network example once to browsers that saved the demo before it existed.
function migrateNetwork(state: DemoState): boolean {
  if (state.networkVersion === 1) return false;
  state.members = Array.isArray(state.members) ? state.members : [];
  state.network = Array.isArray(state.network) ? state.network : [];
  state.invites = state.invites && typeof state.invites === 'object' ? state.invites : {};
  for (const entry of seed.network) if (!state.network.some((item) => item.partnerId === entry.partnerId)) state.network.push(clone(entry));
  for (const [partnerId, code] of Object.entries(seed.invites)) if (!state.invites[partnerId]) state.invites[partnerId] = code;
  for (const offer of state.offers) {
    if (typeof offer.networkBonus !== 'number') offer.networkBonus = seed.offers.find((fixture) => fixture.id === offer.id)?.networkBonus ?? 0;
  }
  for (const lead of state.leads) {
    if (typeof lead.bonusAmount === 'number') continue;
    const fixture = seed.leads.find((entry) => entry.id === lead.id && entry.partnerId === lead.partnerId);
    const bonus = fixture?.bonusAmount ? fixture : null;
    lead.bonusPartnerId = bonus ? bonus.bonusPartnerId : null;
    lead.bonusPartnerName = bonus ? bonus.bonusPartnerName : null;
    lead.bonusAmount = bonus ? bonus.bonusAmount : 0;
    lead.bonusStatus = bonus ? lead.commissionStatus : null;
  }
  if (state.offers.some((offer) => offer.id === 'offer-dinner')) {
    const appendMissing = <T extends { id: string }>(existing: T[], additions: T[]) => {
      const ids = new Set(existing.map((entry) => entry.id));
      for (const entry of additions) if (!ids.has(entry.id)) existing.push(clone(entry));
    };
    appendMissing(state.links, seed.links.filter((link) => link.id === 'link-maya-dinner'));
    appendMissing(state.leads, seed.leads.filter((lead) => lead.id === 'BC-1052') as Lead[]);
    appendMissing(state.activity, seed.activity.filter((event) => event.leadId === 'BC-1052') as DemoActivity[]);
  }
  state.networkVersion = 1;
  return true;
}

function inviteCodeFor(state: DemoState, partnerId: string): string {
  if (state.invites[partnerId]) return state.invites[partnerId];
  const codes = new Set(Object.values(state.invites));
  let code: string;
  do { code = referralCode(); } while (codes.has(code));
  state.invites[partnerId] = code;
  return code;
}

function network(state: DemoState, user: User): NetworkInfo {
  const name = (partnerId: string) => state.profiles.find((profile) => profile.id === partnerId)?.name || 'Блогер';
  const parent = state.network.find((item) => item.partnerId === user.id);
  const members = state.network.filter((item) => item.invitedBy === user.id).sort((a, b) => b.invitedAt.localeCompare(a.invitedAt)).map((item) => {
    const leads = state.leads.filter((lead) => lead.partnerId === item.partnerId);
    return {
      id: item.partnerId, name: name(item.partnerId), invitedAt: item.invitedAt,
      bonusUntil: new Date(Date.parse(item.invitedAt) + NETWORK_BONUS_DAYS * DAY).toISOString(),
      leadCount: leads.length, paidCount: leads.filter((lead) => lead.status === 'paid').length,
      bonusEarned: leads.filter((lead) => lead.bonusPartnerId === user.id && (lead.bonusStatus === 'approved' || lead.bonusStatus === 'paid')).reduce((sum, lead) => sum + lead.bonusAmount, 0),
    };
  });
  return { inviteCode: state.invites[user.id] || '', invitedBy: parent ? { name: name(parent.invitedBy), invitedAt: parent.invitedAt } : null, members, bonusDays: NETWORK_BONUS_DAYS };
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
    bonuses: state.leads.filter((lead) => lead.bonusAmount > 0 && (user.role === 'admin' || (user.role === 'business' ? lead.businessId === user.businessId : lead.bonusPartnerId === user.id)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((lead): NetworkBonus => ({ leadId: lead.id, offerId: lead.offerId, businessId: lead.businessId, partnerId: lead.partnerId, partnerName: lead.partnerName, bonusPartnerId: lead.bonusPartnerId!, bonusPartnerName: lead.bonusPartnerName!, amount: lead.bonusAmount, status: lead.bonusStatus!, createdAt: lead.createdAt })),
    network: user.role === 'partner' ? network(state, user) : null,
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
  if (route === '/api/dashboard' && method === 'GET') {
    const user = requireUser(state);
    if (user.role === 'partner' && !state.invites[user.id]) { inviteCodeFor(state, user.id); save(state); }
    return result(dashboard(state, user));
  }

  const inviteRoute = route.match(/^\/api\/invites\/([^/]+)(\/join)?$/);
  if (inviteRoute) {
    let code: string;
    try { code = decodeURIComponent(inviteRoute[1]); } catch { throw new Error('Приглашение не найдено.'); }
    const inviterId = /^[a-f0-9]{24}$/.test(code) ? Object.keys(state.invites).find((partnerId) => state.invites[partnerId] === code) : undefined;
    const inviter = state.profiles.find((profile) => profile.id === inviterId && profile.role === 'partner');
    if (!inviter) throw new Error('Приглашение не найдено.');
    if (!inviteRoute[2] && method === 'GET') return result({ inviter: { name: inviter.name, avatar: inviter.avatar }, bonusDays: NETWORK_BONUS_DAYS });
    if (inviteRoute[2] && method === 'POST') {
      const name = clean(fields.name, 2, 60, 'имя или название блога');
      if (fields.consent !== true) throw new Error('Подтвердите условия участия.');
      if (state.profiles.some((profile) => profile.name.toLowerCase() === name.toLowerCase())) throw new Error('Блогер с таким именем уже есть. Укажи другое имя.');
      const user: User = { id: `partner-${id()}`, name, role: 'partner', initials: initialsOf(name) };
      state.members.push(user);
      state.profiles.push(user);
      state.network.push({ partnerId: user.id, invitedBy: inviter.id, invitedAt: now() });
      inviteCodeFor(state, user.id);
      state.currentProfileId = user.id;
      return commit({ user });
    }
  }

  if (route === '/api/offers' && method === 'POST') {
    const user = requireBusiness(state);
    const businessId = businessIdFor(state, user, fields);
    const offer: Offer = {
      id: `offer-${id()}`, businessId,
      title: clean(fields.title, 3, 100, 'название'),
      description: clean(fields.description, 10, 1000, 'описание'),
      commission: amount(fields.commission, 'комиссия', 100_000_000), networkBonus: percent(fields.networkBonus), currency: 'IDR', active: true,
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
      // The inviter's bonus is fixed when the lead arrives, like the commission itself.
      const sponsor = state.network.find((item) => item.partnerId === link.partnerId);
      const sponsorProfile = sponsor && offer.networkBonus > 0 && Date.parse(createdAt) < Date.parse(sponsor.invitedAt) + NETWORK_BONUS_DAYS * DAY
        ? state.profiles.find((profile) => profile.id === sponsor.invitedBy) : undefined;
      const bonusAmount = sponsorProfile ? networkBonusAmount(offer.commission, offer.networkBonus) : 0;
      const lead: Lead = {
        id: `BC-${id().slice(0, 8).toUpperCase()}`, offerId: offer.id, businessId: offer.businessId,
        partnerId: link.partnerId, partnerName: link.partnerName, clientName, contact, comment,
        status: 'new', saleAmount: null, commission: offer.commission, currency: 'IDR', commissionStatus: 'pending', createdAt, updatedAt: createdAt,
        bonusPartnerId: bonusAmount ? sponsorProfile!.id : null, bonusPartnerName: bonusAmount ? sponsorProfile!.name : null,
        bonusAmount, bonusStatus: bonusAmount ? 'pending' : null,
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
    if (lead.bonusStatus === 'paid') throw new Error('Сетевой бонус уже выплачен. Изменение требует отдельной сверки.');
    const saleAmount = status === 'paid' ? amount(fields.saleAmount, 'сумма продажи') : lead.saleAmount;
    const reason = status === 'cancelled' ? clean(fields.reason, 3, 300, 'причину отмены') : null;
    lead.status = status;
    lead.saleAmount = saleAmount;
    lead.commissionStatus = status === 'paid' ? 'approved' : status === 'cancelled' ? 'void' : lead.commissionStatus;
    if (lead.bonusStatus) lead.bonusStatus = status === 'paid' ? 'approved' : status === 'cancelled' ? 'void' : lead.bonusStatus;
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
    const bonusLeads = state.leads.filter((lead) => lead.businessId === businessId && lead.bonusPartnerId === partner.id && lead.status === 'paid' && lead.bonusStatus === 'approved');
    if (!leads.length && !bonusLeads.length) throw new Error('Нет подтверждённых начислений для выплаты.');
    const total = leads.reduce((sum, lead) => sum + lead.commission, 0) + bonusLeads.reduce((sum, lead) => sum + lead.bonusAmount, 0);
    if (!Number.isSafeInteger(total) || total !== expectedAmount) throw new Error('Сумма начислений изменилась. Обновите список и сверьте сумму перевода перед записью выплаты.');
    const payout: Payout = { id: id(), businessId, partnerId: partner.id, partnerName: partner.name, amount: total, currency: 'IDR', reference, createdAt: now() };
    state.payouts.unshift(payout);
    for (const lead of leads) { lead.commissionStatus = 'paid'; lead.updatedAt = payout.createdAt; }
    for (const lead of bonusLeads) { lead.bonusStatus = 'paid'; lead.updatedAt = payout.createdAt; }
    addActivity(state, { businessId, partnerId: partner.id, leadId: null, actor: user.name, message: `Зафиксирована выплата ${partner.name}: ${total.toLocaleString('ru-RU')} IDR · ${reference}` }, payout.createdAt);
    return commit({ payout });
  }

  throw new Error('Такой API-маршрут не найден.');
}
