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

## 8. Маркетинг (барања од веб, е-пошта, feed)

| Променлива | Задолжително | Опис |
|---|---|---|
| `ALLOWED_ORIGINS` | не | Дополнителни домени за CORS на `/api/public/*` (запирка). `https://serafimoski.tech` и `https://www.serafimoski.tech` се секогаш дозволени. |
| `APP_URL` | препорачано | Јавна адреса на ERP-то — линк во интерните е-пораки и URL на feed-от. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | за е-пошта | SMTP од env (резерва ако нема SMTP во Подесувања → Фирма). |
| `MAIL_PROVIDER` + `BREVO_API_KEY` / `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_REGION` | не | Праќање преку API наместо SMTP. SES: преку SMTP. |
| `MAIL_FROM` | со API провајдер | Испраќач, на пр. `Серафимоски <ponudi@serafimoski.tech>`. |
| `LEAD_RATE_LIMIT` | не | Барања по IP за 10 мин (default 5). |
| `FEED_TOKEN`, `FEED_BRAND`, `PUBLIC_SITE_URL` | не | Заштита и бренд на product feed-от. |
| `MARKETING_SCHEDULER_DISABLED` | не | `true` го исклучува маркетинг планерот (не се извршува и кога `DISABLE_REMINDERS=true`). |

Чекори по deploy:
1. Миграцијата е автоматска (табели `mkt_leads`, `mkt_lead_files`, `mkt_lead_events`, `app_notifications`; колони `mkt_*` на понуди/нарачки/фактури; веб-полиња на производи).
2. Е-пошта: Подесувања → Фирма → SMTP или `SMTP_*`. Без е-пошта барањата се примаат, само не се праќа автоматски одговор.
3. **DNS на serafimoski.tech нема DMARC запис** — пред праќање кампањи додај `_dmarc` TXT: `v=DMARC1; p=none; rua=mailto:dmarc@serafimoski.tech` (SPF/DKIM за Titan веќе постојат; за Brevo/Mailgun додај ги нивните DKIM записи).
4. Формата на веб-страницата: види [docs/WEBSITE-FORM.md](docs/WEBSITE-FORM.md).
5. Проверка: `curl -i -X OPTIONS -H "Origin: https://serafimoski.tech" -H "Access-Control-Request-Method: POST" $APP_URL/api/public/lead` → `access-control-allow-origin: https://serafimoski.tech`.

## Застарено (не следи)

Претходни верзии од овој водич спомнуваа **MySQL** и разделен Cloudflare Pages + API. Тековниот код е **PostgreSQL** + монолитен Node сервер.
