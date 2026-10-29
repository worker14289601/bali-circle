import { appHref, STATIC_DEMO } from '../routing';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowUpRight, Check, Copy, Link2, Plus, Tag, Users, Wallet } from 'lucide-react';
import { api, date, money, referralUrl, referralDisplayUrl } from '../api';
import { Avatar, Button, Empty, Modal } from '../components/UI';
import type { DashboardData, Offer, Payout, ReferralLink } from '../types';

interface PageProps {
  data: DashboardData;
  onRefresh: () => Promise<void>;
  notify: (message: string) => void;
}

interface ShareState {
  title: string;
  code: string;
}

function ShareLink({ share, onClose, notify }: {
  share: ShareState;
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const url = referralUrl(share.code);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setError('');
      notify('Ссылка скопирована');
    } catch {
      setError('Выделите ссылку ниже и скопируйте её вручную.');
    }
  }
  return <Modal title="Партнёрская ссылка" onClose={onClose}>
    <div className="stack">
      <p className="muted">{share.title}. Заявки по этой ссылке сохранятся за указанным партнёром.</p>
      <div className="form-field">Демо-адрес
        <div className="input link-preview">{referralDisplayUrl(share.code)}</div>
      </div>
      <p className="muted">Домен показан для примера. Кнопка копирует рабочую ссылку на демо.</p>
      {error ? <><p className="form-error" role="alert">{error}</p><label className="form-field">Рабочая ссылка<input className="input" readOnly value={url} onFocus={event=>event.currentTarget.select()}/></label></> : null}
      <div className="form-actions">
        <Button variant="dark" onClick={copy}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? 'Скопировано' : 'Скопировать ссылку'}</Button>
        <a className="button button-secondary" href={appHref(`/r/${share.code}`)}>Открыть предложение <ArrowUpRight size={17} /></a>
      </div>
    </div>
  </Modal>;
}

export function OffersPage({ data, onRefresh, notify }: PageProps) {
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState(false);
  const [linkPending, setLinkPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [share, setShare] = useState<ShareState | null>(null);
  const isPartner = data.user.role === 'partner';

  async function getLink(offer: Offer) {
    setLinkPending(offer.id);
    try {
      const result = await api<{ link: ReferralLink }>('/api/links', { method: 'POST', body: JSON.stringify({ offerId: offer.id }) });
      setShare({ title: `${offer.title} · ${result.link.partnerName}`, code: result.link.code });
      await onRefresh();
    } catch (issue) {
      notify(issue instanceof Error ? issue.message : 'Не удалось получить ссылку');
    } finally {
      setLinkPending(null);
    }
  }

  async function createOffer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const commission = Number(fields.get('commission'));
    if (!Number.isSafeInteger(commission) || commission < 1 || commission > 100_000_000) {
      setError('Укажите вознаграждение от 1 до 100 000 000 IDR.');
      return;
    }
    setPending(true);
    setError('');
    try {
      await api<{ offer: Offer }>('/api/offers', {
        method: 'POST',
        body: JSON.stringify({
          title: String(fields.get('title') || '').trim(),
          description: String(fields.get('description') || '').trim(),
          commission,
          businessId: data.user.role === 'admin' ? String(fields.get('businessId')) : data.user.businessId,
        }),
      });
      await onRefresh();
      setCreating(false);
      notify('Предложение создано');
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Не удалось создать предложение');
    } finally {
      setPending(false);
    }
  }

  return <>
    <div className="page-heading">
      <div><h1>Предложения</h1><p className="page-subtitle">{isPartner ? 'Выберите услугу, которой хотите поделиться.' : 'Понятные условия для ваших партнёров.'}</p></div>
      {!isPartner ? <Button variant="primary" onClick={() => { setError(''); setCreating(true); }}><Plus size={18} />Создать предложение</Button> : null}
    </div>
    <section className="panel" aria-label="Список предложений">
      <div className="panel-header"><h2>Партнёрские программы</h2><span className="muted">{data.offers.length} предложений</span></div>
      {data.offers.length ? <div className="offer-list">{data.offers.map((offer) => <div className="offer-row" key={offer.id}>
        <div className="offer-icon"><Tag size={21} /></div>
        <div className="offer-content">
          <div className="inline"><h3>{offer.title}</h3><span className={`status ${offer.active ? 'status-paid' : 'status-cancelled'}`}>{offer.active ? 'Активно' : 'На паузе'}</span></div>
          <p className="muted">{data.businesses.find((business) => business.id === offer.businessId)?.name}</p>
          <p>{offer.description}</p>
        </div>
        <div className="offer-meta"><strong className="amount">{money(offer.commission)}</strong><span className="muted">за оплатившего клиента</span>
          <Button variant="secondary" disabled={!offer.active || linkPending !== null} onClick={() => getLink(offer)}><Link2 size={16} />{linkPending === offer.id ? 'Готовим…' : 'Получить ссылку'}</Button>
        </div>
      </div>)}</div> : <Empty title="Предложений пока нет" description={isPartner ? 'Подключённые программы появятся здесь.' : 'Создайте первую программу и задайте вознаграждение.'} />}
    </section>
    {creating ? <Modal title="Новое предложение" onClose={() => { if (!pending) setCreating(false); }}>
      <form className="stack" onSubmit={createOffer}>
        {data.user.role === 'admin' ? <label className="form-field">Бизнес<select className="input" name="businessId" required defaultValue={data.businesses[0]?.id}>{data.businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}</select></label> : null}
        <label className="form-field">Название услуги<input className="input" name="title" placeholder="Например, туристическая виза C1" required minLength={3} maxLength={100} autoFocus /></label>
        <label className="form-field">Что получает клиент<textarea className="input" name="description" placeholder="Коротко опишите услугу и условия обращения" required minLength={10} maxLength={1000} rows={4} /></label>
        <label className="form-field">Вознаграждение за оплатившего клиента, IDR<input className="input" type="number" name="commission" placeholder="150000" min={1} max={100_000_000} step={1} required /></label>
        <p className="muted">Для новых заявок действует эта ставка. Комиссии по уже созданным заявкам сохраняются.</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="form-actions"><Button variant="secondary" type="button" disabled={pending} onClick={() => setCreating(false)}>Отмена</Button><Button variant="primary" type="submit" disabled={pending}>{pending ? 'Сохраняем…' : 'Создать предложение'}</Button></div>
      </form>
    </Modal> : null}
    {share ? <ShareLink share={share} onClose={() => setShare(null)} notify={notify} /> : null}
  </>;
}

export function PartnersPage({ data, notify }: PageProps) {
  const [share, setShare] = useState<ShareState | null>(null);
  const groups = new Map<string, { id: string; name: string; links: ReferralLink[] }>();
  for (const link of data.links) {
    if (!groups.has(link.partnerId)) groups.set(link.partnerId, { id: link.partnerId, name: link.partnerName, links: [] });
    groups.get(link.partnerId)!.links.push(link);
  }
  for (const lead of data.leads) if (!groups.has(lead.partnerId)) groups.set(lead.partnerId, { id: lead.partnerId, name: lead.partnerName, links: [] });
  const isPartner = data.user.role === 'partner';
  const partners = Array.from(groups.values()).map((partner) => {
    const leads = data.leads.filter((lead) => lead.partnerId === partner.id);
    const paidCount = leads.filter((lead) => lead.status === 'paid').length;
    const earned = leads
      .filter((lead) => lead.commissionStatus === 'approved' || lead.commissionStatus === 'paid')
      .reduce((sum, lead) => sum + lead.commission, 0);
    return { ...partner, leadCount: leads.length, paidCount, earned };
  });
  const sharePartnerLink = (partnerName: string, link: ReferralLink) => {
    const offerTitle = data.offers.find((offer) => offer.id === link.offerId)?.title || 'Предложение';
    setShare({ title: `${offerTitle} · ${partnerName}`, code: link.code });
  };
  return <>
    <div className="page-heading"><div><h1>{isPartner ? 'Мои ссылки' : 'Партнёры'}</h1><p className="page-subtitle">{isPartner ? 'Ваши программы и результаты рекомендаций.' : 'Люди, которые рекомендуют ваш бизнес.'}</p></div><div className="muted inline"><Users size={18} />{groups.size} {isPartner ? 'профиль' : 'партнёра'}</div></div>
    <section className="panel" aria-label="Результаты партнёров">
      <div className="panel-header"><h2>{isPartner ? 'Результаты рекомендаций' : 'Партнёры и результаты'}</h2></div>
      {partners.length ? <>
        <div className="table-wrap desktop-table">
          <table className="data-table">
            <thead><tr><th>Партнёр</th><th>Заявки</th><th>Оплаченные</th><th>Начислено</th><th>Партнёрские ссылки</th></tr></thead>
            <tbody>{partners.map((partner) => <tr key={partner.id}>
              <td><div className="inline"><Avatar name={partner.name} image={partner.id==='partner-leo'?'leo-avatar.jpg':undefined}/><strong>{partner.name}</strong></div></td>
              <td>{partner.leadCount}</td>
              <td>{partner.paidCount}</td>
              <td className="amount">{money(partner.earned)}</td>
              <td><div className="stack">{partner.links.length ? partner.links.map((link) => <button className="text-button inline" key={link.id} onClick={() => sharePartnerLink(partner.name, link)}><Link2 size={15} />{data.offers.find((offer) => offer.id === link.offerId)?.title || link.code}<ArrowUpRight size={14} /></button>) : <span className="muted">Ссылок пока нет</span>}</div></td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="mobile-records" role="list" aria-label={isPartner ? 'Мои результаты и ссылки' : 'Партнёры и результаты'}>
          {partners.map((partner) => <article className="mobile-record" role="listitem" key={partner.id}>
            <div className="record-heading">
              <div className="inline">
                <Avatar name={partner.name} image={partner.id==='partner-leo'?'leo-avatar.jpg':undefined}/>
                <h3>{partner.name}</h3>
              </div>
            </div>
            <dl className="record-pairs">
              <div><dt>Заявки</dt><dd>{partner.leadCount}</dd></div>
              <div><dt>Оплаченные</dt><dd>{partner.paidCount}</dd></div>
              <div><dt>Начислено</dt><dd className="amount">{money(partner.earned)}</dd></div>
            </dl>
            <div className="record-actions">
              {partner.links.length ? partner.links.map((link) => <Button
                key={link.id}
                variant="secondary"
                onClick={() => sharePartnerLink(partner.name, link)}
              >
                <Link2 size={17} />
                <span>{data.offers.find((offer) => offer.id === link.offerId)?.title || link.code}</span>
                <ArrowUpRight size={17} />
              </Button>) : <p className="muted">Ссылок пока нет</p>}
            </div>
          </article>)}
        </div>
      </> : <Empty title="Партнёров пока нет" description="Первая партнёрская ссылка появится после подключения к предложению." />}
    </section>
    <div className="notice inline" style={{ marginTop: 20 }}><Link2 size={18} /><span>Ссылки доступны в разделе «Предложения». Созданные заявки закрепляются за партнёром {STATIC_DEMO ? 'в этом браузере' : 'на сервере'}.</span></div>
    {share ? <ShareLink share={share} onClose={() => setShare(null)} notify={notify} /> : null}
  </>;
}

interface DueGroup { partnerId: string; partnerName: string; businessId: string; amount: number; count: number }

export function PayoutsPage({ data, onRefresh, notify }: PageProps) {
  const [selected, setSelected] = useState<DueGroup | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const groups = new Map<string, DueGroup>();
  for (const lead of data.leads) {
    if (lead.commissionStatus !== 'approved') continue;
    const key = `${lead.businessId}:${lead.partnerId}`;
    if (!groups.has(key)) groups.set(key, { partnerId: lead.partnerId, partnerName: lead.partnerName, businessId: lead.businessId, amount: 0, count: 0 });
    const group = groups.get(key)!;
    group.amount += lead.commission;
    group.count += 1;
  }
  const isPartner = data.user.role === 'partner';
  const due = Array.from(groups.values());
  const totalDue = due.reduce((sum, group) => sum + group.amount, 0);
  const totalPaid = data.payouts.reduce((sum, payout) => sum + payout.amount, 0);

  async function recordPayout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const reference = String(new FormData(event.currentTarget).get('reference') || '').trim();
    if (!reference) { setError('Укажите номер или подтверждение перевода.'); return; }
    setPending(true);
    setError('');
    try {
      await api<{ payout: Payout }>('/api/payouts', { method: 'POST', body: JSON.stringify({ partnerId: selected.partnerId, businessId: selected.businessId, reference, expectedAmount: selected.amount }) });
      await onRefresh();
      setSelected(null);
      notify('Выплата записана. Начисления отмечены как выплаченные.');
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Не удалось записать выплату');
      await onRefresh().catch(() => {});
    } finally {
      setPending(false);
    }
  }

  return <>
    <div className="page-heading"><div><h1>Выплаты</h1><p className="page-subtitle">{isPartner ? 'Подтверждённые начисления и история вознаграждений.' : 'Подтверждённые комиссии и учёт переводов партнёрам.'}</p></div><Wallet size={25} className="muted" /></div>
    <div className="panel payout-summary"><div><span className="muted">К выплате</span><strong className="amount">{money(totalDue)}</strong></div><div><span className="muted">Записано выплат</span><strong className="amount">{money(totalPaid)}</strong></div></div>
    <section className="panel" style={{ marginTop: 24 }} aria-label="Начисления к выплате">
      <div className="panel-header"><h2>Готово к выплате</h2><span className="muted">После подтверждения оплаты клиента</span></div>
      {due.length ? <>
        <div className="table-wrap desktop-table">
          <table className="data-table">
            <thead><tr><th>Партнёр</th><th>Бизнес</th><th>Продажи</th><th>Сумма</th>{!isPartner ? <th><span className="sr-only">Действие</span></th> : null}</tr></thead>
            <tbody>{due.map((group) => <tr key={`${group.businessId}:${group.partnerId}`}>
              <td><strong>{group.partnerName}</strong></td>
              <td>{data.businesses.find((business) => business.id === group.businessId)?.name}</td>
              <td>{group.count}</td>
              <td className="amount">{money(group.amount)}</td>
              {!isPartner ? <td><Button variant="secondary" onClick={() => { setError(''); setSelected(group); }}>Записать выплату</Button></td> : null}
            </tr>)}</tbody>
          </table>
        </div>
        <div className="mobile-records" role="list" aria-label="Начисления к выплате">
          {due.map((group) => <article className="mobile-record" role="listitem" key={`${group.businessId}:${group.partnerId}`}>
            <div className="record-heading">
              <h3>{group.partnerName}</h3>
              <strong className="amount">{money(group.amount)}</strong>
            </div>
            <p className="record-business">{data.businesses.find((business) => business.id === group.businessId)?.name}</p>
            <dl className="record-pairs">
              <div><dt>Подтверждённые продажи</dt><dd>{group.count}</dd></div>
              <div><dt>Статус</dt><dd>К выплате</dd></div>
            </dl>
            {!isPartner ? <div className="record-actions">
              <Button variant="secondary" onClick={() => { setError(''); setSelected(group); }}>Записать выплату</Button>
            </div> : null}
          </article>)}
        </div>
      </> : <Empty title="Всё рассчитано" description="Новые суммы появятся после подтверждения следующих продаж." />}
    </section>
    <section className="panel" style={{ marginTop: 24 }} aria-label="История выплат">
      <div className="panel-header"><h2>История выплат</h2><span className="muted">{data.payouts.length} записей</span></div>
      {data.payouts.length ? <>
        <div className="table-wrap desktop-table">
          <table className="data-table">
            <thead><tr><th>Дата</th><th>Партнёр</th><th>Бизнес</th><th>Сумма</th><th>Подтверждение</th><th>Статус</th></tr></thead>
            <tbody>{data.payouts.map((payout) => <tr key={payout.id}>
              <td className="muted">{date(payout.createdAt)}</td>
              <td><strong>{payout.partnerName}</strong></td>
              <td>{data.businesses.find((business) => business.id === payout.businessId)?.name}</td>
              <td className="amount">{money(payout.amount)}</td>
              <td>{payout.reference}</td>
              <td><span className="status status-paid">Записана</span></td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="mobile-records" role="list" aria-label="История выплат">
          {data.payouts.map((payout) => <article className="mobile-record" role="listitem" key={payout.id}>
            <div className="record-heading">
              <h3>{payout.partnerName}</h3>
              <strong className="amount">{money(payout.amount)}</strong>
            </div>
            <p className="record-business">{data.businesses.find((business) => business.id === payout.businessId)?.name}</p>
            <dl className="record-pairs">
              <div><dt>Дата</dt><dd>{date(payout.createdAt)}</dd></div>
              <div><dt>Статус</dt><dd><span className="status status-paid">Записана</span></dd></div>
              <div><dt>Подтверждение</dt><dd>{payout.reference}</dd></div>
            </dl>
          </article>)}
        </div>
      </> : <Empty title="Выплат пока нет" description="Здесь появятся переводы, записанные бизнесом." />}
    </section>
    <p className="muted" style={{ marginTop: 16 }}>Запись в системе отражает подтверждение бизнеса и сама по себе не подтверждает поступление денег на счёт партнёра.</p>
    {selected ? <Modal title="Записать выплату" onClose={() => { if (!pending) setSelected(null); }}>
      <form className="stack" onSubmit={recordPayout}>
        <div className="notice">Сначала переведите деньги партнёру, затем сохраните номер перевода. Сервис не отправляет деньги.</div>
        <div className="inline" style={{ justifyContent: 'space-between' }}><strong>{selected.partnerName}</strong><strong className="amount">{money(selected.amount)}</strong></div>
        <p className="muted">{selected.count} подтверждённых начислений · {data.businesses.find((business) => business.id === selected.businessId)?.name}</p>
        <label className="form-field">Номер перевода или подтверждение<input className="input" name="reference" required minLength={3} maxLength={120} placeholder="Например, DEMO-TRANSFER-001" autoFocus /></label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="form-actions"><Button type="button" variant="secondary" disabled={pending} onClick={() => setSelected(null)}>Отмена</Button><Button type="submit" variant="primary" disabled={pending}>{pending ? 'Сохраняем…' : 'Подтвердить запись'}</Button></div>
      </form>
    </Modal> : null}
  </>;
}
