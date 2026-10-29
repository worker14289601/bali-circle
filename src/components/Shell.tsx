import { appHref, STATIC_DEMO } from '../routing';
import { ArrowLeft, Building2, LayoutDashboard, ListFilter, Users, Tag, Wallet, LogOut, Menu, X, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from '../types';
import { Avatar, Button, Logo } from './UI';

const nav=[{path:'/',label:'Обзор',icon:LayoutDashboard},{path:'/leads',label:'Заявки',icon:ListFilter},{path:'/partners',label:'Партнёры',icon:Users},{path:'/offers',label:'Предложения',icon:Tag},{path:'/payouts',label:'Выплаты',icon:Wallet}];
export function Shell({user,profiles,route,navigate,switchProfile,logout,children}:{user:User;profiles:User[];route:string;navigate:(path:string)=>void;switchProfile:(id:string)=>void;logout:()=>void;children:ReactNode}) {
  const [mobileOpen,setMobileOpen]=useState(false);
  const roleName=user.role==='partner'?'Кабинет блогера':user.role==='admin'?'Кабинет администратора':'Кабинет бизнеса';
  const go=(path:string)=>{navigate(path);setMobileOpen(false);};
  const reset=async()=>{if(window.confirm('Начать демо заново? Заявки и выплаты в этом браузере заменятся вымышленными примерами.')){const {resetDemo}=await import('../demo');resetDemo();window.location.href=appHref('/');window.location.reload();}};
  return <div className="app-shell"><a className="skip-link" href={STATIC_DEMO?appHref(route):'#main'} onClick={e=>{e.preventDefault();document.getElementById('main')?.focus();}}>К содержимому</a>
    <aside className={`sidebar ${mobileOpen?'sidebar-open':''}`} aria-label="Главная навигация">
      <div className="sidebar-brand"><a href={appHref('/')} onClick={e=>{e.preventDefault();go('/');}} aria-label="Bali Circle — обзор"><Logo/></a><Button variant="ghost" className="mobile-close icon-button" aria-label="Закрыть меню" onClick={()=>setMobileOpen(false)}><X size={20}/></Button></div>
      <div className="workspace-label">{user.role==='partner'?'Партнёрский кабинет':user.role==='admin'?'Управление платформой':'Бизнес-кабинет'}</div>
      <div className="workspace"><Building2 size={20}/><span>{user.role==='business'||user.role==='partner'?user.name:'Все бизнесы'}</span></div>
      <nav>{nav.map(({path,label,icon:Icon})=><a key={path} href={appHref(path)} className={`nav-item ${route===path?'active':''}`} aria-current={route===path?'page':undefined} onClick={e=>{e.preventDefault();go(path);}}><Icon size={20} strokeWidth={1.65}/>{user.role==='partner'&&path==='/partners'?'Мои ссылки':label}</a>)}</nav>
      <div className="sidebar-bottom"><div className="pilot-note"><span className="live-dot"/>Закрытый пилот<span>Бали, Индонезия</span></div><div className="account"><Avatar name={user.name}/><div><strong>{user.name}</strong><span>{user.role==='business'?'Владелец бизнеса':user.role==='partner'?'Партнёр':'Администратор'}</span></div><button onClick={logout} className="logout" aria-label="Выйти из демо-кабинета"><LogOut size={16}/></button></div></div>
    </aside>
    {mobileOpen?<button className="sidebar-scrim" aria-label="Закрыть меню" onClick={()=>setMobileOpen(false)}/>:null}
    <div className="main-shell"><header className="topbar"><div className="topbar-title"><Button variant="ghost" className="mobile-menu icon-button" aria-label="Открыть меню" onClick={()=>setMobileOpen(true)}><Menu size={21}/></Button><ArrowLeft size={16} className="desktop-back"/><span>{roleName}</span></div><div className="topbar-right"><span className="demo-tag"><span className="live-dot"/>{STATIC_DEMO?'Демо · данные в этом браузере':'Демо · данные для знакомства'}</span><div className="role-select"><Avatar name={user.name}/><select aria-label="Сменить демо-профиль" value={user.id} onChange={e=>switchProfile(e.target.value)}>{profiles.map(profile=><option value={profile.id} key={profile.id}>{profile.role==='business'?'Бизнес':profile.role==='partner'?'Блогер':'Админ'} · {profile.name}</option>)}</select><ChevronDown size={14}/></div></div></header><main id="main" className="main-content" tabIndex={-1}>{children}</main><footer className="app-footer"><span>bali circle · первая версия</span><span>Демо-вход. Используйте только вымышленные данные.</span>{STATIC_DEMO?<button className="text-button" onClick={()=>void reset()}>Начать демо заново</button>:null}</footer></div>
  </div>;
}
