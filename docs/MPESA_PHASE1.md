# Phase 1 — M-Pesa compatibility (Kenya)

**Status:** Ready for your approval before Phase 2 (Daraja STK implementation)  
**Date:** 2026-08-21  
**Scope:** Compatibility + architecture only — **no live STK charges yet**

---

## Product routing (locked for Phase 2+)

| Signup market | Country / currency | Live gateway (target) | Phase 1 behavior |
|---------------|--------------------|------------------------|------------------|
| Kenya | Kenya + KES | **M-Pesa (Daraja STK Push)** | Routed as `mpesa` in planner; charges still **stub** until Phase 2 |
| India | India + INR | **Razorpay** (Phase 3) | Routed as `razorpay`; charges still **stub** |
| Other | anything else | stub / unsupported | Demo stub |

Gateway is resolved **on the server** from the user profile (never trust client alone).

**Phase 1 assumption:** Direct **Safaricom Daraja** (not IntaSend, not aggregator). Change this before Phase 2 if you prefer Pesapal/Flutterwave.

---

## Compatibility checklist

| Check | Result | Notes |
|-------|--------|-------|
| Payment interface (`createCharge` → paid/pending + ids) | ✅ Ready | Stub proves the shape; pending + 402 path already in controllers |
| Async STK (PENDING → callback → paid) | ✅ Ready | Reuse `nextPaymentTransition`; wire callback in Phase 2 |
| `Payment` model | ✅ Ready | `gateway`, `status`, `amount`, `currency`, `reference`, `meta`, provider ids |
| B2C fulfill (job → processing) | ✅ Ready | `paymentsController` after `paid` |
| B2B fulfill (credits) | ✅ Ready | `creditsController` after `paid` |
| HTTPS callback on Vercel | ✅ Ready | `https://zdc-backend.vercel.app/api/payments/mpesa/callback` |
| Phone on profile | ⚠️ Gap | **B2B:** required at signup. **B2C:** optional / settings only — Phase 2 must collect phone at pay or signup |
| Country + currency | ⚠️ Partial | **B2B:** `business.address.country` + `business.currency`. **B2C:** no country/currency fields yet — Phase 2 should add or infer Kenya for KE launch |
| Pack currency | ⚠️ KES-only | Pricing/credits packs are KES — OK for Kenya Phase 2; India needs INR packs in Phase 3 |
| Env / secrets | ⚠️ Placeholders | Full `MPESA_*` list added to `.env.example`; values go on Vercel in Phase 2 |

**Verdict:** Compatible enough to build Daraja STK in Phase 2 without rewriting the app. Gaps are signup/phone (B2C) and enabling the provider — not architecture blockers.

---

## Target sequence (Phase 2)

```text
Pay click (B2C try-on or B2B credits)
  → resolveMarketGateway(user)  // Kenya+KES → mpesa
  → if MPESA_ENABLED: MpesaProvider.createCharge (STK Push)
  → Payment status = pending (CheckoutRequestID in meta / providerCheckoutId)
  → UI: “Approve on phone” + poll GET /api/payments/:id
  → Daraja POST /api/payments/mpesa/callback
  → nextPaymentTransition → paid once
  → fulfill job / credits
```

### UI (Kenya)

1. Prefill MSISDN from `user.phone` (or WhatsApp for B2B)  
2. Confirm / edit phone → **Pay with M-Pesa**  
3. Waiting state (STK prompt)  
4. Success → existing try-on / credits success UI  
5. Fail / timeout → retry  

---

## Env vars (Phase 2 deploy)

```text
MPESA_ENABLED=false
MPESA_ENV=sandbox
MPESA_CONSUMER_KEY=
MPESA_CONSUMER_SECRET=
MPESA_SHORTCODE=
MPESA_PASSKEY=
MPESA_CALLBACK_URL=https://zdc-backend.vercel.app/api/payments/mpesa/callback
```

Never expose secrets as `NEXT_PUBLIC_*`.

---

## Risks

| Risk | Mitigation |
|------|------------|
| Sandbox STK flaky / 1037 | Test with Safaricom sandbox numbers; don’t block Phase 2 on sandbox alone |
| Phone format (`07…` vs `254…`) | `normalizeKenyaMsisdn` utility (added in Phase 1) |
| Duplicate callbacks | `nextPaymentTransition` + unique provider ids |
| B2C missing phone | Require phone at pay time (Phase 2) |
| Read-only Vercel FS | Already using `/tmp` for local uploads; callbacks are HTTP only |

---

## Code added in Phase 1 (no live charges)

| File | Purpose |
|------|---------|
| `src/services/payments.js` | `resolveMarketGateway(user)` routing planner |
| `src/utils/phone.js` | Kenya MSISDN normalize |
| `docs/MPESA_PHASE1.md` | This document |
| `.env.example` | Full `MPESA_*` placeholders |
| `payments.test.js` | Routing + phone tests |

`resolveGateway("mpesa")` still **rejects charges** until Phase 2 sets `MPESA_ENABLED=true` and implements Daraja.

---

## Phase 2 file touch list (when you approve)

Backend: `payments.js`, new `services/mpesa/`, `phone.js`, `paymentsController.js`, `creditsController.js`, `routes/payments.js`, `env.js`, `Payment.js` (if needed), tests.  
Frontend: B2C pay UI phone + wait, B2B credits, optional B2C register phone/country.

---

## Approve / changes needed

Reply with one of:

1. **Approve Phase 1 → start Phase 2 (Daraja STK)**  
2. **Changes needed:** (e.g. use Pesapal instead of Daraja; require B2C country at signup first; Kenya-only launch with no India routing yet)

I will **not** push — you push manually when ready.
