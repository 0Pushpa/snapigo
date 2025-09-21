import { supabase } from './supabase';

export type Coupon = {
  id: string;
  owner_id: string;
  store: string | null;
  title: string | null;
  terms: string | null;
  expires_at: string | null;     // ISO
  image_url: string | null;
  stable_id: string | null;
  attrs: Record<string, any> | null;
  created_at: string;
};

export async function getMyCoupons() {
  const { data, error } = await supabase
    .from('coupons')
    .select('id, store, title, terms, expires_at, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as Coupon[];
}

// We'll use this in the next step to replace the fake scan
export async function addCoupon(partial: Partial<Coupon>) {
  const { data, error } = await supabase
    .from('coupons')
    .insert(partial)
    .select()
    .single();
  if (error) throw error;
  return data as Coupon;
}
