export type Role = 'business' | 'partner' | 'admin';
export interface User { id:string; name:string; role:Role; businessId?:string; businessName?:string; initials:string; avatar?:string }
export interface Business { id:string; name:string; category:string; description:string }
export interface Offer { id:string; businessId:string; title:string; description:string; commission:number; currency:'IDR'; active:boolean }
export interface ReferralLink { id:string; offerId:string; partnerId:string; partnerName:string; code:string; clicks:number }
export type LeadStatus = 'new'|'contacted'|'paid'|'cancelled';
export interface Lead { id:string; offerId:string; businessId:string; partnerId:string; partnerName:string; clientName:string; contact?:string; comment?:string; status:LeadStatus; saleAmount:number|null; commission:number; currency:'IDR'; commissionStatus:'pending'|'approved'|'paid'|'void'; createdAt:string; updatedAt:string }
export interface Payout { id:string; partnerId:string; partnerName:string; businessId:string; amount:number; currency:'IDR'; reference:string; createdAt:string }
export interface Activity { id:string; leadId:string|null; actor:string; message:string; createdAt:string }
export interface DashboardData { user:User; businesses:Business[]; offers:Offer[]; links:ReferralLink[]; leads:Lead[]; payouts:Payout[]; activity:Activity[] }
export interface SessionData { user:User|null; profiles:User[]; demo:true }
export interface PublicReferral { offer:Offer; business:Business; partnerName:string; code:string }
