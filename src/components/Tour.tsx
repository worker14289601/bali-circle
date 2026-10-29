import { appHref } from '../routing';
import { ArrowRight, ChevronDown, ChevronUp, Lightbulb } from 'lucide-react';
import type { User } from '../types';
import { Button } from './UI';

// Seeded referral link of Leo for the шMargaret dinner; the same code is used by the server and the Pages demo.
const LEO_DINNER_CODE = 'b91a7e4065d3c8f20ab9467e';

interface Step { title: string; text: string; action: string; profile?: string; path?: string; href?: string }

const steps: Step[] = [
  { title: 'Ты — блогер', text: 'Лео берёт свою ссылку на ужин в шMargaret.', action: 'Открыть кабинет Лео', profile: 'partner-leo', path: '/offers' },
  { title: 'Ты — клиент', text: 'Переходишь по ссылке Лео и оставляешь заявку на столик.', action: 'Открыть страницу клиента', href: `/r/${LEO_DINNER_CODE}` },
  { title: 'Ты — ресторан', text: 'шMargaret открывает заявку и подтверждает оплату.', action: 'Открыть кабинет ресторана', profile: 'biz-food', path: '/leads' },
  { title: 'Блогер видит деньги', text: 'У Лео заявка оплачена, вознаграждение начислено.', action: 'Вернуться к Лео', profile: 'partner-leo', path: '/' },
  { title: 'Сеть блогеров', text: 'Лео зовёт других блогеров и получает бонус с их продаж.', action: 'Открыть «Мои блогеры»', profile: 'partner-leo', path: '/network' },
];

export function DemoTour({ open, onToggle, user, switchProfile, navigate }: {
  open: boolean;
  onToggle: (open: boolean) => void;
  user: User;
  switchProfile: (id: string, path?: string) => void;
  navigate: (path: string) => void;
}) {
  function go(step: Step) {
    if (step.href) { window.location.assign(appHref(step.href)); return; }
    if (step.profile && step.profile !== user.id) switchProfile(step.profile, step.path);
    else navigate(step.path || '/');
  }
  if (!open) return <button className="panel demo-tour-toggle" aria-expanded="false" onClick={() => onToggle(true)}>
    <Lightbulb size={18} /><span><strong>Как это работает?</strong> 5 шагов за минуту</span><ChevronDown size={18} />
  </button>;
  return <section className="panel demo-tour" aria-label="Как это работает">
    <div className="demo-tour-header">
      <div><h2>Как это работает — 5 шагов</h2><p className="muted">Глазами блогера, клиента и ресторана. Роль переключается сама.</p></div>
      <Button variant="ghost" className="icon-button" aria-label="Свернуть подсказку" aria-expanded="true" onClick={() => onToggle(false)}><ChevronUp size={18} /></Button>
    </div>
    <ol className="demo-tour-steps">{steps.map((step, index) => <li key={step.title}>
      <span className="demo-tour-number">{index + 1}</span>
      <div><strong>{step.title}</strong><p>{step.text}</p><button className="text-button" onClick={() => go(step)}>{step.action}<ArrowRight size={14} /></button></div>
    </li>)}</ol>
    <p className="demo-tour-note">Роль можно сменить и вручную — справа сверху, «Смотреть как». Эта подсказка также открывается из меню: «Как пройти демо».</p>
  </section>;
}
