import { appHref, STATIC_DEMO } from './routing';
export async function api<T>(path:string, options:RequestInit = {}):Promise<T> {
  if(STATIC_DEMO){const {demoRequest}=await import('./demo');return demoRequest<T>(path,options);}
  const response = await fetch(path, { ...options, headers: { 'Content-Type':'application/json', ...options.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || body.message || 'Не удалось выполнить запрос. Попробуйте ещё раз.');
  return body;
}
export const money = (value:number) => `Rp ${new Intl.NumberFormat('ru-RU', { maximumFractionDigits:0 }).format(value)}`;
export const date = (value:string) => new Intl.DateTimeFormat('ru-RU', { day:'numeric',month:'short', timeZone:'Asia/Makassar' }).format(new Date(value));
export const statusLabels = { new:'Новая', contacted:'В работе', paid:'Оплачена', cancelled:'Отменена' };
export const commissionLabels = { pending:'После оплаты', approved:'К выплате', paid:'Выплачено', void:'Отменено' };
export const referralUrl = (code:string) => `${window.location.origin}${appHref(`/r/${code}`)}`;
export async function downloadCsv() {
  const data = await api<import('./types').DashboardData>('/api/dashboard');
  const quote = (value:unknown) => {let text=String(value??'');if(/^[=+@\-\t\r]/.test(text))text=`'${text}`;return `"${text.replaceAll('"','""')}"`;};
  const rows=[['Заявка','Клиент','Контакт','Партнёр','Статус','Комиссия IDR','Начисление'],...data.leads.map(lead=>[lead.id,lead.clientName,lead.contact||'',lead.partnerName,statusLabels[lead.status],lead.commission,commissionLabels[lead.commissionStatus]])];
  const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(row=>row.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download='bali-circle-demo.csv';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
