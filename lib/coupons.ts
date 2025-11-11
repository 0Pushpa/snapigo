// lib/coupon.ts
import { supabase } from './supabase';

export type Visibility = 'private' | 'public';
export type Category = 'food' | 'retail' | 'grocery' | 'other';

export type Coupon = {
  id: string;
  owner_id: string;
  store: string | null;
  title: string | null;
  terms: string | null;
  expires_at: string | null;
  image_url: string | null;
  stable_id: string | null;
  attrs: Record<string, any> | null;
  created_at: string;
  updated_at?: string;
  visibility: Visibility;
  category: Category;
  publication: string | null;            // 👈 NEW FIELD
  saves_count?: number;
};

export type NewCouponInput = {
  owner_id: string;
  store?: string | null;
  title?: string | null;
  terms?: string | null;
  expires_at?: string | null;
  image_url?: string | null;
  stable_id?: string | null;
  attrs?: Record<string, any> | null;
  visibility?: Visibility;
  category?: Category;
  publication?: string | null;           // 👈 NEW FIELD
};

/** Get coupons I own */
export async function getMyCoupons() {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const uid = userData.user?.id;
  if (!uid) throw new Error('Not signed in');

  const { data, error } = await supabase
    .from('coupons')
    .select(
      'id, store, title, terms, expires_at, created_at, visibility, category, publication, saves_count'
    )
    .eq('owner_id', uid)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as Coupon[];
}

/** Add a new coupon */
export async function addCoupon(input: NewCouponInput) {
  const normalize = (s?: string | null) => {
    const v = (s ?? '').trim();
    return v.length ? v : null;
  };

  const payload = {
    owner_id: input.owner_id,
    store: normalize(input.store),
    title: normalize(input.title),
    terms: normalize(input.terms),
    expires_at: input.expires_at ?? null,
    image_url: input.image_url ?? null,
    stable_id: normalize(input.stable_id),
    attrs: input.attrs ?? null,
    visibility: (input.visibility ?? 'private') as Visibility,
    category: (input.category ?? 'other') as Category,
    publication: normalize(input.publication), // 👈 added
  };

  const { data, error } = await supabase
    .from('coupons')
    .insert(payload)
    .select('*')
    .single();

  if (error) throw error;
  return data as Coupon;
}

/** Delete a coupon I own (RLS will block others). */
export async function deleteCoupon(couponId: string) {
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user?.id;
  if (!uid) throw new Error('Not signed in');

  const { error } = await supabase
    .from('coupons')
    .delete()
    .eq('id', couponId)
    .eq('owner_id', uid); // enforced by RLS too

  if (error) throw error;
  return { ok: true };
}

/** Optional: Fetch coupons by scope & publication (for lists) */
export async function getCouponsByScope({
  scope,
  publication,
  q,
  limit = 50,
  offset = 0,
}: {
  scope: Visibility;
  publication?: string | null;
  q?: string;
  limit?: number;
  offset?: number;
}) {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData?.user?.id ?? null;

  let query = supabase
    .from('coupons')
    .select(
      'id, store, title, terms, expires_at, created_at, visibility, category, publication, saves_count'
    );

  if (scope === 'public') query = query.eq('visibility', 'public');
  else {
    if (!uid) throw new Error('Not signed in');
    query = query.eq('owner_id', uid);
  }

  if (publication && publication.trim()) {
    query = query.ilike('publication', publication.trim());
  }

  if (q && q.trim()) {
    const term = `%${q.trim()}%`;
    query = query.or(
      `title.ilike.${term},store.ilike.${term},publication.ilike.${term}`
    );
  }

  const { data, error } = await query
    .order('expires_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;
  return (data ?? []) as Coupon[];
}

/** Optional: Suggest existing publications for autocomplete */
export async function getPublicationSuggestions(limit = 50) {
  const { data, error } = await supabase
    .from('coupons')
    .select('publication')
    .not('publication', 'is', null)
    .neq('publication', '')
    .order('publication', { ascending: true })
    .limit(limit);

  if (error) throw error;

  const uniq = Array.from(
    new Set(
      (data ?? [])
        .map((d) => (d.publication ?? '').trim())
        .filter((v) => v.length)
    )
  );
  return uniq;
}
