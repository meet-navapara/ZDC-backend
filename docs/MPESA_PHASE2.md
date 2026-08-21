# Phase 2 — M-Pesa Daraja STK (Kenya)

**Status:** Implemented locally (awaiting your push + Daraja credentials)  
**Depends on:** Phase 1 approved

## What shipped

| Piece | Path |
|-------|------|
| Daraja OAuth + STK Push + query | `src/services/mpesa/daraja.js` |
| Provider | `src/services/mpesa/provider.js` |
| Callback parse + fulfill | `src/services/mpesa/parseCallback.js`, `fulfill.js` |
| Public callback | `POST /api/payments/mpesa/callback` |
| B2C / B2B pay | `paymentsController`, `creditsController` |
| Kenya UI | B2C try-on + B2B credits (phone + wait for PIN) |

## Enable on Vercel / local

```text
MPESA_ENABLED=true
MPESA_ENV=sandbox
MPESA_CONSUMER_KEY=...
MPESA_CONSUMER_SECRET=...
MPESA_SHORTCODE=...
MPESA_PASSKEY=...
MPESA_CALLBACK_URL=https://zdc-backend.vercel.app/api/payments/mpesa/callback
MPESA_TRANSACTION_TYPE=CustomerPayBillOnline
```

Callback URL must be **HTTPS** and reachable by Safaricom (Vercel backend is fine).

## Behaviour

1. Kenya / KES user → gateway auto-selects `mpesa` when enabled  
2. STK Push → Payment `pending` → UI waits  
3. Daraja callback → `paid` → fulfill try-on job or B2B credits  
4. If `MPESA_ENABLED` is false → demo **stub** (instant pay) still works  

## Sandbox test

1. Create Daraja sandbox app + Lipa Na M-Pesa Online  
2. Use Safaricom sandbox test MSISDN from their docs  
3. Pay from B2C try-on or B2B credits with that phone  
4. Confirm Payment → `paid` and job/credits fulfill  

## Next

**Phase 3 — Razorpay (India / INR)** after Kenya STK is verified in sandbox (or live).
