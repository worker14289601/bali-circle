import { appHref } from '../routing';
import { useState } from 'react';
import { ArrowRight, Check, CheckCircle2, Coins, Copy, Link2, UserPlus, Users, Wallet } from 'lucide-react';
import { commissionLabels, date, inviteDisplayUrl, inviteUrl, money } from '../api';
import { Avatar, Button, Empty } from '../components/UI';
import type { DashboardData, NetworkInfo } from '../types';

export function NetworkPage({ data, notify, network }: {
  data: DashboardData;
  notify: (message: string) => void;
  network: NetworkInfo;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const url = inviteUrl(network.inviteCode);
  const months = Math.round(network.bonusDays / 30.4);
  const earned = data.bonuses.filter((bonus) => bonus.status === 'approved' || bonus.status === 'paid').reduce((sum, bonus) => sum + bonus.amount, 0);
  const due = data.bonuses.filter((bonus) => bonus.status === 'approved').reduce((sum, bonus) => sum + bonus.amount, 0);
  const metrics = [
    { label: 'Приглашено', value: String(network.members.length), icon: Users },
    { label: 'Их оплаченные продажи', value: String(network.members.reduce((sum, member) => sum + member.paidCount, 0)), icon: CheckCircle2 },
    { label: 'Бонус начислен', value: money(earned), icon: Coins },
    { label: 'Бонус к выплате', value: money(due), icon: Wallet },
  ];
  const offerTitle = (offerId: string) => data.offers.find((offer) => offer.id === offerId)?.title || 'Предложение';
  const businessName = (businessId: string) => data.businesses.find((business) => business.id === businessId)?.name;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setCopyError(false);
      notify('Приглашение скопировано');
    } catch {
      setCopyError(true);
    }
  }

  return <>
    <div className="page-heading">
      <div><h1>Мои блогеры</h1><p className="page-subtitle">Приглашай блогеров и получай бонус с их продаж.</p></div>
      <Button variant="primary" onClick={() => void copy()}>{copied ? <Check size={18} /> : <UserPlus size={18} />}{copied ? 'Скопировано' : 'Пригласить блогера'}</Button>
    </div>
    {network.invitedBy ? <div className="notice inline network-origin"><UserPlus size={18} /><span>Ты в сети по приглашению {network.invitedBy.name} с {date(network.invitedBy.invitedAt)}. Бонус с твоих продаж платит бизнес — твоё вознаграждение не уменьшается.</span></div> : null}
    <div className="metrics-rail">{metrics.map(({ label, value, icon: Icon }, index) => <div className="metric" key={label}><Icon size={25} strokeWidth={1.6} className={index === 1 ? 'success-icon' : ''} /><div><span>{label}</span><strong>{value}</strong></div></div>)}</div>
    <div className="dashboard-columns">
      <section className="panel" aria-label="Приглашённые блогеры">
        <div className="panel-header"><h2>Приглашённые блогеры</h2><span className="muted">{network.members.length} в сети</span></div>
        {network.members.length ? <>
          <div className="table-wrap desktop-table">
            <table className="data-table">
              <thead><tr><th>Блогер</th><th>В сети с</th><th>Заявки</th><th>Оплаченные</th><th>Мой бонус</th></tr></thead>
              <tbody>{network.members.map((member) => <tr key={member.id}>
                <td><div className="inline"><Avatar name={member.name} /><strong>{member.name}</strong></div></td>
                <td className="muted">{date(member.invitedAt)}<small className="commission-state">бонус до {date(member.bonusUntil)}</small></td>
                <td>{member.leadCount}</td>
                <td>{member.paidCount}</td>
                <td className="amount">{money(member.bonusEarned)}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className="mobile-records" role="list" aria-label="Приглашённые блогеры">
            {network.members.map((member) => <article className="mobile-record" role="listitem" key={member.id}>
              <div className="record-heading">
                <div className="inline"><Avatar name={member.name} /><h3>{member.name}</h3></div>
                <strong className="amount">{money(member.bonusEarned)}</strong>
              </div>
              <dl className="record-pairs">
                <div><dt>Заявки</dt><dd>{member.leadCount}</dd></div>
                <div><dt>Оплаченные</dt><dd>{member.paidCount}</dd></div>
                <div><dt>Бонус до</dt><dd>{date(member.bonusUntil)}</dd></div>
              </dl>
            </article>)}
          </div>
        </> : <Empty title="Пока никого" description="Отправь ссылку-приглашение знакомому блогеру. Он появится здесь сразу после регистрации." />}
      </section>
      <aside className="dashboard-aside">
        <section className="panel share-panel">
          <h2>Твоя ссылка-приглашение</h2>
          <div className="stack">
            <div className="copy-input" aria-label="Демо-адрес приглашения"><Link2 size={17} /><span className="referral-display">{inviteDisplayUrl(network.inviteCode)}</span></div>
            <Button variant="dark" onClick={() => void copy()}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? 'Скопировано' : 'Скопировать приглашение'}</Button>
            <small className="demo-domain-note">Демо-домен · копируется рабочая ссылка</small>
            {copyError ? <label className="form-field">Рабочая ссылка<input className="input" readOnly value={url} onFocus={(event) => event.currentTarget.select()} /></label> : null}
            <a href={appHref(`/join/${network.inviteCode}`)} className="text-link">Открыть приглашение <ArrowRight size={15} /></a>
          </div>
        </section>
        <section className="panel steps-panel">
          <h2>Как работает бонус</h2>
          <ol>{[
            ['Блогер регистрируется', 'По твоей ссылке-приглашению'],
            ['Он приводит клиентов', 'По своим партнёрским ссылкам'],
            ['Бизнес платит сверху', 'Процент задаёт бизнес в предложении'],
            [`${months} месяцев, один уровень`, 'Бонус только с тех, кого ты пригласил сам'],
          ].map(([title, description], index) => <li key={title}><span>{index + 1}</span><div><strong>{title}</strong><p>{description}</p></div></li>)}</ol>
        </section>
      </aside>
    </div>
    <section className="panel" style={{ marginTop: 14 }} aria-label="Начисления сетевых бонусов">
      <div className="panel-header"><h2>Начисления бонусов</h2><span className="muted">Бонус начисляется после оплаты клиента</span></div>
      {data.bonuses.length ? <>
        <div className="table-wrap desktop-table">
          <table className="data-table">
            <thead><tr><th>Дата</th><th>Блогер</th><th>Предложение</th><th>Бонус</th><th>Статус</th></tr></thead>
            <tbody>{data.bonuses.map((bonus) => <tr key={bonus.leadId}>
              <td className="muted">{date(bonus.createdAt)}</td>
              <td><strong>{bonus.partnerName}</strong></td>
              <td>{offerTitle(bonus.offerId)}<small className="business-caption">{businessName(bonus.businessId)}</small></td>
              <td className="amount">{money(bonus.status === 'void' ? 0 : bonus.amount)}</td>
              <td><span className="commission-label">{commissionLabels[bonus.status]}</span></td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="mobile-records" role="list" aria-label="Начисления сетевых бонусов">
          {data.bonuses.map((bonus) => <article className="mobile-record" role="listitem" key={bonus.leadId}>
            <div className="record-heading"><h3>{bonus.partnerName}</h3><strong className="amount">{money(bonus.status === 'void' ? 0 : bonus.amount)}</strong></div>
            <p className="record-business">{offerTitle(bonus.offerId)} · {businessName(bonus.businessId)}</p>
            <dl className="record-pairs">
              <div><dt>Дата</dt><dd>{date(bonus.createdAt)}</dd></div>
              <div><dt>Статус</dt><dd>{commissionLabels[bonus.status]}</dd></div>
            </dl>
          </article>)}
        </div>
      </> : <Empty title="Бонусов пока нет" description="Они появятся, когда клиенты приглашённых блогеров оставят заявки." />}
    </section>
  </>;
}
