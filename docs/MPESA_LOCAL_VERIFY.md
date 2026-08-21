# M-Pesa local setup & verification guide

Your Network tab already proves STK **starts** (`payments` → **200**, then polling).  
The pink **DS timeout** means Safaricom never got a PIN — common in sandbox outside Kenya / without simulator.

Use **Path A** to verify zimji’s paid → try-on flow locally.  
Use **Path B** when you want a real Safaricom STK + callback.

---

## Path A — Verify our integration (recommended now)

Simulates “paid” ~4 seconds after STK is accepted. **Sandbox only.**

### 1) `backend/.env` (required values)

```text
MPESA_ENABLED=true
MPESA_ENV=sandbox
MPESA_CONSUMER_KEY=<from Daraja app>
MPESA_CONSUMER_SECRET=<from Daraja app — no trailing dot>
MPESA_SHORTCODE=174379
MPESA_PASSKEY=bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919
MPESA_CALLBACK_URL=https://YOUR-NGROK.ngrok-free.dev/api/payments/mpesa/callback
MPESA_TRANSACTION_TYPE=CustomerPayBillOnline

# THIS unlocks local verification without PIN:
MPESA_SANDBOX_AUTO_PAID=true
```

### 2) Start services (3 terminals)

```powershell
# Terminal 1 — API
cd d:\ZDC\backend
npm run dev

# Terminal 2 — ngrok (keep running; copy https URL)
ngrok http 8080

# Terminal 3 — frontend
cd d:\ZDC\frontend
npm run dev
```

Update `MPESA_CALLBACK_URL` to match the **current** ngrok HTTPS URL + `/api/payments/mpesa/callback`, then **restart backend**.

### 3) Verification checklist

| Step | Expected |
|------|----------|
| Open `http://localhost:3000` → log in | OK |
| Try-on → see **M-Pesa phone** field | `defaultGateway` is mpesa |
| Phone `254708374149` → Pay | Network: `tryon` **201**, `payments` **200** with `"pending": true` |
| UI shows **Confirm on M-Pesa** | Not instant error |
| Backend log within ~4s | `[mpesa] sandbox auto-paid payment=...` |
| UI → processing → result | Job fulfills |

If auto-paid log never appears: `MPESA_SANDBOX_AUTO_PAID` not loaded → restart backend after `.env` change.

### 4) Turn off auto-paid before real tests / deploy

```text
MPESA_SANDBOX_AUTO_PAID=false
```

---

## Path B — Real Safaricom sandbox STK (PIN)

1. Same env as Path A but **`MPESA_SANDBOX_AUTO_PAID=false`**
2. ngrok callback URL must be live
3. Pay with `254708374149`
4. Within **30 seconds** complete STK:
   - Phone prompt **or** Daraja **Lipa Na M-Pesa Online** test/simulator
   - PIN often **`174379`**
5. Backend should log: `callback ... status=paid fulfilled=true`

If you always get **DS timeout / user cannot be reached**: Safaricom sandbox cannot reach a PIN UI on your side. That is **not** a zimji bug — use Path A for fulfill verification, or a real Safaricom handset in KE / Go Live later.

---

## Quick health checks

```text
GET http://localhost:8080/
→ { "name": "zimji API", ... }

GET http://localhost:8080/api/payments/methods
(Authorization: Bearer <token>)
→ defaultGateway: "mpesa", mpesaEnabled: true
```

---

## Production (later)

- `MPESA_ENV=production`
- Live Consumer Key/Secret, real shortcode + passkey from Safaricom
- `MPESA_CALLBACK_URL=https://zdc-backend.vercel.app/api/payments/mpesa/callback`
- **`MPESA_SANDBOX_AUTO_PAID` must be false / unset**
- Real customer phones get real STK prompts

---

## What your last screenshot already proved

- `tryon` **201** → job created  
- `payments` **200** → STK accepted (our 402→200 fix works)  
- Polling payment id → waiting for paid/fail  
- Error text → Safaricom **1037** (no PIN), not a missing API response  

Next: set `MPESA_SANDBOX_AUTO_PAID=true`, restart backend, pay once — you should get a completed try-on.
