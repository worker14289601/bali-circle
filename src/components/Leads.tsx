import { appHref, STATIC_DEMO } from '../routing';
import { useState } from 'react';
import { Search, ArrowUpRight, Download, Check, Clock3, XCircle, Mail, UserRound, CalendarDays } from 'lucide-react';
import { api, money, date, statusLabels, commissionLabels, downloadCsv } from '../api';
import type { DashboardData, Lead, LeadStatus } from '../types';
import { Avatar, Button, Empty, Modal } from './UI';

export function LeadTable({data,compact=false,onSelect}:{data:DashboardData;compact?:boolean;onSelect:(lead:Lead)=>void}) {
  const [filter,setFilter]=useState('all');const [query,setQuery]=useState('');
  const offers=new Map(data.offers.map(o=>[o.id,o]));
  const filtered=data.leads.filter(l=>(filter==='all'||l.status===filter)&&`${l.clientName} ${l.partnerName} ${offers.get(l.offerId)?.title} ${l.id}`.toLowerCase().includes(query.toLowerCase()));
  const leads=compact?filtered.slice(0,6):filtered;
  return <section className="panel leads-panel"><div className="panel-toolbar"><h2>{compact?'Последние заявки':'Все заявки'}<span className="count-label">{data.leads.length}</span></h2><div className="table-tools"><div className="filter-tabs" aria-label="Фильтр заявок">{[['all','Все'],['new','Новые'],['paid','Оплачены']].map(([value,label])=><button key={value} aria-pressed={filter===value} className={filter===value?'selected':''} onClick={()=>setFilter(value)}>{label}</button>)}</div><label className="search-box"><Search size={16}/><input aria-label="Поиск по заявкам" placeholder="Поиск по заявкам" value={query} onChange={e=>setQuery(e.target.value)}/></label></div></div>
    {leads.length?<div className="table-wrap"><table className="data-table lead-table"><thead><tr><th>Клиент</th><th>Партнёр</th><th>Услуга</th><th>Статус</th><th>Комиссия</th><th><span className="sr-only">Подробнее</span></th></tr></thead><tbody>{leads.map((lead,index)=><tr key={lead.id}><td><button className="client-cell" onClick={()=>onSelect(lead)}><Avatar name={lead.clientName} tone={index}/><span>{lead.clientName}<small>{date(lead.createdAt)}</small></span></button></td><td><span className="partner-name">{lead.partnerName}</span></td><td className="service-cell">{offers.get(lead.offerId)?.title||'Услуга'}</td><td><span className={`status status-${lead.status}`}>{statusLabels[lead.status]}</span></td><td><span className="amount">{money(lead.commissionStatus==='void'?0:lead.commission)}</span><small className="commission-state">{commissionLabels[lead.commissionStatus]}</small></td><td><Button variant="ghost" className="icon-button row-open" onClick={()=>onSelect(lead)} aria-label={`Открыть заявку ${lead.clientName}`}><ArrowUpRight size={17}/></Button></td></tr>)}</tbody></table></div>:<Empty title="Заявок пока нет" description={query?'Попробуйте другой запрос.':'Заявки появятся, когда клиент заполнит форму по партнёрской ссылке.'}/>}
    {compact&&filtered.length>6?<a className="table-footer" href={appHref('/leads')}>Посмотреть все {filtered.length} заявок <ArrowUpRight size={16}/></a>:null}
  </section>;
}

export function LeadsPage({data,onSelect}:{data:DashboardData;onSelect:(lead:Lead)=>void}) {
  return <><div className="page-heading"><div><h1>Каждая рекомендация на виду.</h1><p className="page-subtitle">От первого обращения до оплаты и вознаграждения.</p></div><a href={STATIC_DEMO?'#download':'/api/export.csv'} onClick={STATIC_DEMO?e=>{e.preventDefault();void downloadCsv();}:undefined} className="button button-secondary" download><Download size={17}/>Скачать CSV</a></div><LeadTable data={data} onSelect={onSelect}/></>;
}

export function LeadDetail({lead,data,onClose,onRefresh,notify}:{lead:Lead;data:DashboardData;onClose:()=>void;onRefresh:()=>Promise<void>;notify:(s:string)=>void}) {
  const [action,setAction]=useState<LeadStatus|null>(null);const [amount,setAmount]=useState('');const [reason,setReason]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const canEdit=data.user.role!=='partner';
  const offer=data.offers.find(o=>o.id===lead.offerId);
  const events=data.activity.filter(e=>e.leadId===lead.id);
  const save=async(status:LeadStatus)=>{
    setBusy(true);setError('');
    try{await api(`/api/leads/${lead.id}`,{method:'PATCH',body:JSON.stringify({status,...(status==='paid'?{saleAmount:Number(amount)}:{}),...(status==='cancelled'?{reason}:{})})});await onRefresh();notify(status==='paid'?'Оплата подтверждена. Комиссия начислена.':status==='cancelled'?'Заявка отменена.':'Заявка взята в работу.');onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  return <Modal title="Детали заявки" onClose={onClose}><div className="detail-person"><Avatar name={lead.clientName}/><div><h3>{lead.clientName}</h3><span className="muted">{lead.id.slice(0,14)}</span></div><span className={`status status-${lead.status}`}>{statusLabels[lead.status]}</span></div><dl className="detail-grid"><div><dt><UserRound size={15}/>Партнёр</dt><dd>{lead.partnerName}</dd></div><div><dt><CalendarDays size={15}/>Создана</dt><dd>{date(lead.createdAt)}</dd></div><div><dt>Предложение</dt><dd>{offer?.title}</dd></div><div><dt>Вознаграждение</dt><dd>{money(lead.commission)}<small>{commissionLabels[lead.commissionStatus]}</small></dd></div>{lead.contact?<div className="detail-wide"><dt><Mail size={15}/>Контакт клиента</dt><dd>{lead.contact}</dd></div>:null}{lead.comment?<div className="detail-wide"><dt>Комментарий</dt><dd>{lead.comment}</dd></div>:null}{lead.saleAmount?<div><dt>Сумма продажи</dt><dd>{money(lead.saleAmount)}</dd></div>:null}</dl>
    {data.user.role==='partner'?<div className="notice">Статус продажи подтверждает бизнес. Контакты клиента доступны только его менеджеру.</div>:null}
    {events.length?<div className="detail-history"><h3>История заявки</h3>{events.slice(0,5).map(event=><div key={event.id}><span className="history-dot"/><p>{event.message}<small>{event.actor} · {date(event.createdAt)}</small></p></div>)}</div>:null}
    {error?<p className="form-error" role="alert">{error}</p>:null}
    {canEdit&&action==='paid'?<form onSubmit={e=>{e.preventDefault();void save('paid');}} className="stack"><label className="form-field">Сумма полученной оплаты, IDR<input className="input" type="number" min="1" max="100000000000" step="1" required value={amount} onChange={e=>setAmount(e.target.value)} placeholder="Например, 2 000 000" autoFocus/></label><div className="notice">Комиссия {money(lead.commission)} начислится один раз после подтверждения оплаты.</div><div className="form-actions"><Button onClick={()=>setAction(null)}>Назад</Button><Button variant="primary" type="submit" disabled={busy}>{busy?'Сохраняем…':'Подтвердить оплату'}</Button></div></form>:null}
    {canEdit&&action==='cancelled'?<form onSubmit={e=>{e.preventDefault();void save('cancelled');}} className="stack"><label className="form-field">Причина отмены<textarea className="input" required minLength={3} maxLength={300} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Что произошло с заявкой?"/></label><div className="form-actions"><Button onClick={()=>setAction(null)}>Назад</Button><Button type="submit" disabled={busy}>{busy?'Сохраняем…':'Отменить заявку'}</Button></div></form>:null}
    {canEdit&&!action&&lead.status!=='cancelled'?<div className="detail-actions">{lead.status==='new'?<Button disabled={busy} onClick={()=>void save('contacted')}><Clock3 size={16}/>Взять в работу</Button>:null}{lead.status!=='paid'?<Button variant="primary" onClick={()=>setAction('paid')}><Check size={17}/>Подтвердить оплату</Button>:null}{lead.commissionStatus!=='paid'?<Button variant="ghost" onClick={()=>setAction('cancelled')}><XCircle size={16}/>Отменить</Button>:null}</div>:null}
  </Modal>;
}
