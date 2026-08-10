# ZDC Backend (Express + MongoDB)

REST API for the ZDC AI Virtual Try-On Platform.

## Stack
- Node.js + Express
- MongoDB (Mongoose)
- JWT auth (bcrypt hashing)
- helmet, cors, morgan, express-rate-limit, zod validation

## Getting started

```bash
cd backend
cp .env.example .env   # then edit values
npm install
npm run dev            # http://localhost:8080
```

## Environment
See `.env.example`. Minimum required: `MONGODB_URI`, `JWT_SECRET`.
For MongoDB, use a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster for testing.

## Endpoints (Phase 0)

| Method | Path              | Auth | Description                 |
|--------|-------------------|------|-----------------------------|
| GET    | `/`               | no   | Service info                |
| GET    | `/api/health`     | no   | Health + DB status          |
| POST   | `/api/auth/register` | no | Register a user (b2c/b2b/admin) |
| POST   | `/api/auth/login` | no   | Login, returns JWT          |
| GET    | `/api/auth/me`    | yes  | Current user profile        |

### Example

```bash
curl -X POST http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@zdc.app","password":"password123","role":"b2c"}'
```

## Deploy (Render)
This folder includes `render.yaml`. In Render, create a Blueprint from the repo and set the
`MONGODB_URI`, `JWT_SECRET`, and `CORS_ORIGINS` secrets. Health check path is `/api/health`.
