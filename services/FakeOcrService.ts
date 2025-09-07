export type Coupon = {
    merchant: string;
    offer: string;
    address:string;
    expiry?: string;
    createdAt: number;
  };
  
  export async function fakeOcr(): Promise<Coupon> {
    return {
      merchant: "Starbucks",
      offer: "50% off any drink",
      expiry: "2025-12-20",
      address:"123 Street NW , 49505",
      createdAt: Date.now(),
    };
  }
  