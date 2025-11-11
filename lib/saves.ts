// lib/saves.ts
import { supabase } from './supabase';

export async function saveCoupon(couponId: string) {
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user?.id;
  if (!uid) throw new Error('Not signed in');

  const { data, error } = await supabase
    .from('coupon_saves')
    .insert({ user_id: uid, coupon_id: couponId })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function unsaveCoupon(couponId: string) {
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user?.id;
  if (!uid) throw new Error('Not signed in');

  const { error } = await supabase
    .from('coupon_saves')
    .delete()
    .eq('user_id', uid)
    .eq('coupon_id', couponId);

  if (error) throw error;
  return { ok: true };
}

export type SavedRow = {
  id: string;                // save id
  created_at: string;
  coupon: {
    id: string;
    store: string | null;
    title: string | null;
    terms: string | null;
    expires_at: string | null;
    visibility: 'public' | 'private';
    created_at: string;
  } | null;
};

/** List coupons I saved (joins saves → coupons) */
export async function listSavedCoupons(): Promise<SavedRow[]> {
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user?.id;
  if (!uid) throw new Error('Not signed in');

  // RLS will ensure you only see your rows
  const { data, error } = await supabase
    .from('coupon_saves')
    .select(`
      id, created_at,
      coupon:coupons (
        id, store, title, terms, expires_at, visibility, created_at
      )
    `)
    .eq('user_id', uid)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as unknown as SavedRow[];
}
