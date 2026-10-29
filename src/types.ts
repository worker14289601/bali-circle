export type Role = 'business' | 'partner' | 'admin';
export interface User { id:string; name:string; role:Role; businessId?:string; businessName?:string; initials:string; avatar?:string }
export interface Business { id:string; name:string; category:string; description:string }
export interface Offer { id:string; businessId:string; title:string; description:string; commission:number; networkBonus:number; currency:'IDR'; active:boolean }
export interface ReferralLink { id:string; offerId:string; partnerId:string; partnerName:string; code:string; clicks:number }
export type LeadStatus = 'new'|'contacted'|'paid'|'cancelled';
export type CommissionStatus = 'pending'|'approved'|'paid'|'void';
export interface Lead { id:string; offerId:string; businessId:string; partnerId:string; partnerName:string; clientName:string; contact?:string; comment?:string; status:LeadStatus; saleAmount:number|null; commission:number; currency:'IDR'; commissionStatus:CommissionStatus; createdAt:string; updatedAt:string; bonusPartnerId:string|null; bonusPartnerName:string|null; bonusAmount:number; bonusStatus:CommissionStatus|null }
export interface Payout { id:string; partnerId:string; partnerName:string; businessId:string; amount:number; currency:'IDR'; reference:string; createdAt:string }
export interface Activity { id:string; leadId:string|null; actor:string; message:string; createdAt:string }
export interface NetworkBonus { leadId:string; offerId:string; businessId:string; partnerId:string; partnerName:string; bonusPartnerId:string; bonusPartnerName:string; amount:number; status:CommissionStatus; createdAt:string }
export interface NetworkMember { id:string; name:string; invitedAt:string; bonusUntil:string; leadCount:number; paidCount:number; bonusEarned:number }
export interface NetworkInfo { inviteCode:string; invitedBy:{ name:string; invitedAt:string }|null; members:NetworkMember[]; bonusDays:number }
export interface DashboardData { user:User; businesses:Business[]; offers:Offer[]; links:ReferralLink[]; leads:Lead[]; payouts:Payout[]; activity:Activity[]; bonuses:NetworkBonus[]; network:NetworkInfo|null }
export interface SessionData { user:User|null; profiles:User[]; demo:true }
export interface PublicReferral { offer:Offer; business:Business; partnerName:string; code:string }
export interface PublicInvite { inviter:{ name:string; avatar?:string }; bonusDays:number }
