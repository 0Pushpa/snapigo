import React, { createContext, useContext, useMemo, useState } from "react";

export type Coupon = {
  id: string;
  merchant: string;
  offer: string;
  expiry?: string;
  address?: string;
  createdAt: number;
};

type CouponsCtx = {
  coupons: Coupon[];
  addCoupon: (c: Coupon) => void;
  clearCoupons: () => void;
};

const CouponsContext = createContext<CouponsCtx | null>(null);

export function CouponsProvider({ children }: { children: React.ReactNode }) {
  const [coupons, setCoupons] = useState<Coupon[]>([]);

  const value = useMemo<CouponsCtx>(() => ({
    coupons,
    addCoupon: (c) => setCoupons((prev) => {
      if (prev.some((p) => p.id === c.id)) return prev; // avoid duplicates
      return [...prev, c];
    }),
    clearCoupons: () => setCoupons([]),
  }), [coupons]);

  return (
    <CouponsContext.Provider value={value}>{children}</CouponsContext.Provider>
  );
}

export function useCoupons() {
  const ctx = useContext(CouponsContext);
  if (!ctx) throw new Error("useCoupons must be used inside <CouponsProvider>");
  return ctx;
}
