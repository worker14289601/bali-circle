import { useEffect, useRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { X, Inbox, ArrowUpRight } from 'lucide-react';

export function Button({variant='secondary',className='',children,...props}:ButtonHTMLAttributes<HTMLButtonElement>&{variant?:'primary'|'secondary'|'dark'|'ghost'}) {
  return <button type="button" className={`button button-${variant} ${className}`} {...props}>{children}</button>;
}
export function Logo({small=false}:{small?:boolean}) {
  return <span className={`brand ${small?'brand-small':''}`}><svg viewBox="0 0 44 32" aria-hidden="true"><circle cx="17" cy="16" r="12" fill="none" stroke="currentColor" strokeWidth="2.6"/><circle cx="29" cy="16" r="12" fill="none" stroke="#a5cc30" strokeWidth="2.6"/></svg><span>bali circle<span className="brand-dot">.</span></span></span>;
}
export function Avatar({name,tone=0,image}:{name:string;tone?:number;image?:string}) {
  const letters=name.split(' ').filter(word=>word&&word!=='на'&&word!=='·').slice(0,2).map(s=>s[0]).join('');
  return <span className={`avatar avatar-${tone%5}`} aria-hidden="true">{image?<img src={`${import.meta.env.BASE_URL}${image}`} alt="" width={40} height={40}/>:letters}</span>;
}
export function Empty({title,description}:{title:string;description?:string}) {
  return <div className="empty-state"><Inbox size={30} strokeWidth={1.5}/><h3>{title}</h3>{description?<p>{description}</p>:null}</div>;
}
export function Modal({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}) {
  const ref=useRef<HTMLDivElement>(null);
  const close=useRef(onClose); close.current=onClose;
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const oldOverflow=document.body.style.overflow; document.body.style.overflow='hidden';
    const dialog=ref.current;
    const focusable=()=>Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]')||[]);
    focusable()[0]?.focus();
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape') close.current();
      if(event.key==='Tab') {const nodes=focusable(); const first=nodes[0],last=nodes.at(-1); if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
    };
    document.addEventListener('keydown',key);
    return ()=>{document.body.style.overflow=oldOverflow;document.removeEventListener('keydown',key);previous?.focus();};
  },[]);
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={ref}><div className="modal-header"><h2 id="modal-title">{title}</h2><Button variant="ghost" className="icon-button" aria-label="Закрыть" onClick={onClose}><X size={20}/></Button></div>{children}</div></div>;
}
export function ExternalArrow(){return <ArrowUpRight size={16} aria-hidden="true"/>;}
