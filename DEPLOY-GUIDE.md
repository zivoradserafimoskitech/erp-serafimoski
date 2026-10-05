# Deploy Guide — ERP Серафимоски Тек

## Архитектура (препорачано)

Еден Node сервис што служи **и** API **и** статичкиот frontend (`dist/public`):

```
erp.vashdomain.mk  →  Railway / Render  (Node 20 + PostgreSQL)
```

Алтернатива (разделен frontend) е можна, но не е потребна — `api/railway.ts` веќе ја служи SPA.

## Барања

- Node.js 20+
- **PostgreSQL** (не MySQL)
- Environment: најмалку `DATABASE_URL`

## 1. PostgreSQL

Креирај база, на пр.:

```text
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/serafimoski
```

На облак провајдери SSL е обично вклучен. За локално:

```text
DATABASE_SSL=false
```

Шемата се усогласува **автоматски при старт** (`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`). Не треба рачен `drizzle-kit push` за стандарден deploy.

## 2. Railway

1. New Project → Deploy from GitHub → одбери го овој репозиториум.
2. Add Plugin / Database → **PostgreSQL** (не MySQL).
3. Variables на веб-сервисот:

| Променлива | Вредност |
|------------|----------|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (или копија од Postgres) |
| `APP_PASSWORD` | силна лозинка (или создај админ преку setup UI по прв deploy) |
| `CERT_ENCRYPTION_KEY` | `openssl rand -hex 32` |
| `NODE_ENV` | `production` |
| `PORT` | го поставува Railway |

4. Build / Start (ако не се детектираат од `package.json` / `Procfile`):

```text
buildCommand: npm install && npm run build
startCommand: npm start
```

5. Custom Domain: `erp.vashdomain.mk` → CNAME според Railway.

## 3. Render

`render.yaml` е вклучен. Креирај Web Service од repo:

- Build: `npm install && npm run build`
- Start: `npm start`
- Додај **PostgreSQL** инстанца и поврзи `DATABASE_URL`.

## 4. Cloudflare Pages + посебен API (опционално)

Ако сакаш статички frontend на Pages:

1. Build: `npm run build` — artifact `dist/public`
2. `VITE_API_URL=https://api.vashdomain.mk/api/trpc` при build
3. API на Railway како погоре, само CORS/домейн

За повеќето инсталации **не е потребно** — монолитниот сервер е поедноставен.

## 5. Автентикација на продукција

- **Не** поставувај `DISABLE_USER_GATE=true` на продукција.
- Или `APP_PASSWORD`, или отвори ја апликацијата еднаш и создај администратор на setup екранот.
- Потоа: Подесувања → Корисници за улоги (admin / manager / accountant / operator / viewer).

## 6. По deploy — проверка

```bash
curl -s https://erp.vashdomain.mk/api/trpc/ping
# или health ако е изложен
```

1. Најава / setup админ  
2. Подесувања → податоци за фирма (ЕДБ, банка, ДДВ)  
3. Склад / клиенти — smoke test  

## 7. Бекап

Во апликацијата: Подесувања → Бекап (ако е вклучен scheduler). Дополнително: редовен dump на PostgreSQL од провајдерот.

## Застарено (не следи)

Претходни верзии од овој водич спомнуваа **MySQL** и разделен Cloudflare Pages + API. Тековниот код е **PostgreSQL** + монолитен Node сервер.
