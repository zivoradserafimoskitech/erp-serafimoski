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
| `CREDIT_LIMIT_STRICT` | `false` (default) или `true` за блок на понуди над кредитен лимит |
| `UJP_ENV` | `test` (default) или `production` |
| `UJP_API_KEY` | клуч од УЈП (задолжително за продукциско испраќање) |
| `SKIP_AUTO_MIGRATE` | само ако мораш да го исклучиш boot migrate (`true`) — **не** на продукција |

### Автоматски миграции

При секој `npm start` / boot, `api/railway.ts` ја повикува `runMigrations()` → `getInitSql()` (вклучува `getExtraSql()` од `init-db-v2.ts`):

- `invoices.salesperson`, `orders`/`quotations.salesperson`
- `order_items.delivered_qty` / `reserved_qty`
- `sales_returns` (+ `credit_note_id`), `sales_return_items`

Сите се `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` — идемпотентни. Рачен `/api/init-db?key=...` е резерва.

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
- Истите Variables како погоре (`APP_PASSWORD`, `CERT_ENCRYPTION_KEY`, опционално `CREDIT_LIMIT_STRICT`, `UJP_*`).

Постоечки CORS цели во кодот: `*.up.railway.app`, `erp-serafimoski.onrender.com` (види `api/railway.ts`). Примерен custom domain во водичот: `erp.vashdomain.mk`.

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

## 5a. CRM: е-пошта и автоматски потсетници

**SMTP (праќање понуди по мејл, дигест)** — внеси го во *Подесувања → Фирма → Праќање е-пошта*, **или** постави env променливи на сервисот (Railway/Render → Variables):

| Променлива | Пример | Забелешка |
|---|---|---|
| `SMTP_HOST` | `smtp.vashdomain.mk` | задолжително за env варијантата |
| `SMTP_PORT` | `587` | 465 → автоматски TLS |
| `SMTP_USER` / `SMTP_PASS` | `erp@vashdomain.mk` / `…` | |
| `SMTP_FROM` | `Серафимоски Тек <erp@vashdomain.mk>` | стандардно = `SMTP_USER` |
| `SMTP_SECURE` | `false` | опционално |

Подесувањата во апликацијата имаат предност пред env. Без SMTP „Прати по мејл“ покажува порака што треба да се постави — ништо не паѓа.
Секоја пратена понуда се запишува во `crm_email_log` + активност „е-пошта“ на фирмата/контактот/зделката, понудата станува **Пратена**, а зделката оди во фаза „Понуда пратена“.

**Автоматски потсетници** — серверот на секои 30 мин. создава задачи и известувања (ѕвонче во заглавјето): понуда без одговор по N дена, зделка со поминат рок за затворање, задачи што доцнат. Идемпотентно (секој потсетник еднаш).
- `CRM_QUOTE_FOLLOWUP_DAYS` (стандардно `3`; поставката во *CRM → Активности → Потсетници* има предност)
- `CRM_REMINDERS_DISABLED=true` — исклучи (исто и `DISABLE_REMINDERS=true` ги исклучува сите планери)
- `APP_URL` — опционално, за линкови во дневниот дигест (дигестот се вклучува во *Потсетници*, со е-пошта по продавач)

Нема рачни чекори за базата — табелите/колоните се создаваат автоматски при старт.
**Дојдовна пошта (IMAP синхронизација)** засега не е вклучена; `crm_email_log.direction` (`out`/`in`) е подготвено за тоа.

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
