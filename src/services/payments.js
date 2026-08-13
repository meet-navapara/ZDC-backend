// Payment provider interface.
//
// The gateway (M-Pesa Daraja / Intasend) is not finalized yet, so a stub
// provider marks charges as paid immediately. This keeps the checkout flow
// working end-to-end. Replace StubProvider with MpesaProvider / IntasendProvider
// (same interface) once the gateway and credentials are chosen.

class StubProvider {
  constructor() {
    this.name = "stub";
  }

  async createCharge({ amount, currency, reference }) {
    return {
      status: "paid",
      gateway: this.name,
      reference: reference || `stub_${Date.now()}`,
      amount,
      currency,
    };
  }
}

let provider;

export function getPaymentProvider() {
  if (!provider) {
    // if (process.env.MPESA_CONSUMER_KEY) provider = new MpesaProvider();
    // else if (process.env.INTASEND_API_KEY) provider = new IntasendProvider();
    provider = new StubProvider();
  }
  return provider;
}
