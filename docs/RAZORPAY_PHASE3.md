# Phase 3 — Razorpay (India / INR)

**Status:** Implemented (enable with keys)  
**Depends on:** Phase 2 M-Pesa approved

## What shipped

| Piece | Path |
|-------|------|
| Razorpay Orders API | `src/services/razorpay/client.js` |
| Provider | `src/services/razorpay/provider.js` |
| Checkout verify | `POST /api/payments/razorpay/verify` |
| Webhook | `POST /api/payments/razorpay/webhook` |
| INR pack amounts | `src/config/inrPricing.js` (localized by market) |
| India UI | B2C try-on + B2B credits (Checkout modal) |

## Routing

| Market | Currency | Gateway |
|--------|----------|---------|
| Kenya | KES | M-Pesa |
| India | INR | Razorpay |
| Other | — | stub / demo |

India B2B accounts (`business.currency=INR` + country India) get INR credit packs and Razorpay Checkout.

## Enable on Vercel / local

```text
RAZORPAY_ENABLED=true
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
```

Webhook URL in Razorpay Dashboard:

`https://YOUR-BACKEND.vercel.app/api/payments/razorpay/webhook`

Events: `payment.captured`, `payment.failed`.

## Flow

1. India / INR user → gateway `razorpay`
2. Create Razorpay Order → Payment `pending`
3. Frontend opens Checkout.js → user pays (UPI / card / netbanking)
4. Frontend `POST /api/payments/razorpay/verify` (signature) → fulfill
5. Webhook is a backup fulfill path

## INR placeholders (override in admin pricing later)

| Pack | INR |
|------|-----|
| B2C single | ₹49 |
| B2C trio | ₹99 |
| Credits starter | ₹499 |
| Credits growth | ₹1499 |
| Credits scale | ₹4999 |

## Test checklist

1. Register / use B2B with **India** + **INR**
2. Credits → packs show INR → **Pay with Razorpay**
3. Complete test payment in Razorpay test mode
4. Credits balance increases; invoice downloads
5. Kenya accounts still use M-Pesa (unchanged)

## Notes

- B2C India: set country/currency at personal signup or in **Settings** — try-on packs then show INR and Razorpay Checkout.
- Do not commit live secrets; set them only in Vercel env.
- Test keys use `rzp_test_`; live keys use `rzp_live_`.
- B2B India works via business profile country + currency.
