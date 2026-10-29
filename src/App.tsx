import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Building2, CheckCircle2, RefreshCw, Users, ShieldCheck } from 'lucide-react';
import { api } from './api';
import type { DashboardData, Lead, SessionData, User } from './types';
import { Shell } from './components/Shell';
import { Button, Logo } from './components/UI';
import { LeadDetail, LeadsPage } from './components/Leads';
import { Dashboard } from './pages/Dashboard';
import { OffersPage, PartnersPage, PayoutsPage } from './pages/Secondary';
import { ReferralPage } from './pages/Referral';
import { JoinPage } from './pages/Join';
import { NetworkPage } from './pages/Network';
import { currentRoute, navigateTo } from './routing';

export default function App(){
  const [activeRoute,setActiveRoute]=useState(currentRoute);
  useEffect(()=>{const update=()=>setActiveRoute(currentRoute());window.addEventListener('hashchange',update);window.addEventListener('popstate',update);return()=>{window.removeEventListener('hashchange',update);window.removeEventListener('popstate',update);};},[]);
  const referral=activeRoute.match(/^\/r\/([^/]+)\/?$/);
  if(referral){let code=referral[1];try{code=decodeURIComponent(code);}catch{/* The API returns a readable unavailable state for malformed links. */}return <ReferralPage code={code}/>;}
  const invite=activeRoute.match(/^\/join\/([^/]+)\/?$/);
  if(invite){let code=invite[1];try{code=decodeURIComponent(code);}catch{/* The API returns a readable unavailable state for malformed links. */}return <JoinPage code={code}/>;}
  return <Workspace/>;
}
function Workspace(){
  const [session,setSession]=useState<SessionData|null>(null);const [data,setData]=useState<DashboardData|null>(null);const [route,setRoute]=useState(currentRoute);const [error,setError]=useState('');const [switching,setSwitching]=useState(false);const [selected,setSelected]=useState<Lead|null>(null);const [toast,setToast]=useState('');
  const generation=useRef(0);
  const notify=useCallback((message:string)=>setToast(message),[]);
  const refresh=useCallback(async()=>{const active=generation.current;const next=await api<DashboardData>('/api/dashboard');if(active===generation.current)setData(next);},[]);
  const switchProfile=useCallback(async(id:string)=>{const active=++generation.current;setSwitching(true);setError('');setData(null);setSelected(null);try{const {user}=await api<{user:User}>('/api/demo-login',{method:'POST',body:JSON.stringify({profileId:id})});const next=await api<DashboardData>('/api/dashboard');if(active!==generation.current)return;setSession(current=>current?{...current,user}:null);setData(next);setRoute('/');navigateTo('/');}catch(e){if(active===generation.current)setError((e as Error).message);}finally{if(active===generation.current)setSwitching(false);}},[]);
  useEffect(()=>{let cancelled=false;void (async()=>{try{const current=await api<SessionData>('/api/session');if(cancelled)return;setSession(current);if(current.user){await refresh();}else{await switchProfile(current.profiles.find(profile=>profile.role==='admin')?.id||current.profiles.find(profile=>profile.role==='business')?.id||'biz-visa');}}catch(e){setError((e as Error).message);}})();return()=>{cancelled=true;};},[refresh,switchProfile]);
  useEffect(()=>{const onPop=()=>setRoute(currentRoute());window.addEventListener('popstate',onPop);window.addEventListener('hashchange',onPop);return()=>{window.removeEventListener('popstate',onPop);window.removeEventListener('hashchange',onPop);};},[]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),4000);return()=>clearTimeout(timer);},[toast]);
  const navigate=(path:string)=>{navigateTo(path);setRoute(path);setSelected(null);window.scrollTo({top:0,behavior:'instant'});};
  const logout=async()=>{++generation.current;try{await api('/api/logout',{method:'POST',body:'{}'});setSession(current=>current?{...current,user:null}:null);setData(null);}catch(e){notify((e as Error).message);}};
  if(error&&!data)return <div className="standalone-state"><Logo/><h1>Не удалось открыть кабинет</h1><p>{error}</p><Button onClick={()=>window.location.reload()}><RefreshCw size={16}/>Попробовать ещё раз</Button></div>;
  if(!session||switching)return <div className="standalone-state"><Logo/><div className="loader"/><p>{switching?'Открываем демо-кабинет…':'Собираем ваши рекомендации…'}</p></div>;
  if(!session.user)return <div className="welcome"><Logo/><h1>Хорошие рекомендации.<br/>Понятный результат.</h1><p>Выбери роль и посмотри, как всё работает.</p><div className="welcome-profiles">{session.profiles.slice(0,3).map(profile=>{const Icon=profile.role==='business'?Building2:profile.role==='partner'?Users:ShieldCheck;return <button key={profile.id} onClick={()=>void switchProfile(profile.id)}><Icon size={24}/><span><strong>{profile.role==='business'?'Я — бизнес':profile.role==='partner'?'Я — блогер':'Все примеры'}</strong><small>{profile.name}</small></span><ArrowRight size={18}/></button>;})}</div><p className="muted">Демо-вход без пароля. Используй выдуманные данные.</p></div>;
  if(!data)return <div className="standalone-state"><Logo/><div className="loader"/><p>Загружаем данные…</p></div>;
  const shared={data,onRefresh:refresh,notify};
  return <Shell user={session.user} profiles={session.profiles} route={route} navigate={navigate} switchProfile={id=>void switchProfile(id)} logout={()=>void logout()}>{error?<div className="form-error" role="alert">{error}</div>:null}{session.user.role!=='partner'?<div className="demo-business-switcher"><label htmlFor="business-examples">Примеры бизнесов</label><select id="business-examples" className="input" value={session.user.role==='admin'?'admin':session.user.id} onChange={event=>void switchProfile(event.target.value)}><option value="admin">Все бизнесы</option>{session.profiles.filter(profile=>profile.role==='business').map(profile=><option value={profile.id} key={profile.id}>{profile.businessName||profile.name}</option>)}</select></div>:null}{route==='/leads'?<LeadsPage data={data} onSelect={setSelected}/>:route==='/partners'?<PartnersPage {...shared}/>:route==='/offers'?<OffersPage {...shared}/>:route==='/payouts'?<PayoutsPage {...shared}/>:route==='/network'&&data.network?<NetworkPage {...shared} network={data.network}/>:<Dashboard key={session.user.id} {...shared} onSelect={setSelected} navigate={navigate}/>} {selected?<LeadDetail lead={selected} data={data} onClose={()=>setSelected(null)} onRefresh={refresh} notify={notify}/>:null}{toast?<div className="toast" role="status"><CheckCircle2 size={18}/>{toast}</div>:null}</Shell>;
}
