# ERP Серафимоски Тек

ERP систем за метална фабрикација: склад, производство, понуди/нарачки, фактури, финансии (ДДВ), CRM, набавка, квалитет, HR и клиентски портал.

**Стек:** React 19 + TypeScript + Vite 7 + Tailwind · Hono + tRPC 11 · PostgreSQL (Drizzle) · Vitest

## Барања

- Node.js ≥ 20
- PostgreSQL ≥ 14
- `npm` (lockfile е вклучен)

## Брз старт (локално)

```bash
# 1) Клонирај и инсталирај
git clone https://github.com/zivoradserafimoskitech/erp-serafimoski.git
cd erp-serafimoski
npm install

# 2) Опкружување
cp .env.example .env
# Уреди DATABASE_URL=postgres://user:pass@localhost:5432/serafimoski

# 3) API сервер (автоматски ги применува IF NOT EXISTS миграциите при старт)
npm run dev
# → http://127.0.0.1:3000  (служи API; frontend по build во dist/public)

# 4) Frontend со HMR (втор терминал) — проксира /api кон :3000
npm run build          # еднаш, за лого/статички фајлови ако треба
npm run dev:client     # → http://127.0.0.1:5173
```

### Автентикација

По подразбирање системот е **затворен** (fail-safe).

| Режим | Како |
|--------|------|
| Продукција | Постави `APP_PASSWORD` **или** создај администратор при прв старт (setup екран) |
| Локално отворено | `DISABLE_USER_GATE=true` во `.env` (**никогаш** на продукција) |

## Скрипти

| Команда | Опис |
|---------|------|
| `npm run dev` | API + сервер (`tsx watch api/railway.ts`) |
| `npm run dev:client` | Vite frontend со HMR (прокси `/api` → `:3000`) |
| `npm run build` | Typecheck + Vite build + bundle на серверот → `dist/` |
| `npm start` | Продукциски сервер: `node dist/server.cjs` |
| `npm run typecheck` / `npm run lint` | TypeScript проверка |
| `npm test` | Vitest (unit); интеграциски само со `TEST_DATABASE_URL` |

```bash
# Интеграциски тест — користи ПОСЕБНА празна база (брише schema!)
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/erp_test npm test
```

## Структура

```
api/           tRPC рутери, auth, bootstrap на шема
contracts/     споделена бизнис-логика (улоги, ДДВ, …)
db/            Drizzle schema, seed
src/pages/     UI екрани
src/components/компоненти и дијалози
public/        статички ресурси (лого)
```

## Deploy

Види [DEPLOY-GUIDE.md](./DEPLOY-GUIDE.md) — Railway / Render + PostgreSQL.

Накратко:

```bash
npm run build
npm start
# потребно: DATABASE_URL (postgres), и APP_PASSWORD или прв админ
```

## Лиценца

Private — © Серафимоски Тек
