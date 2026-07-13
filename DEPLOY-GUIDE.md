# Deploy Guide - ERP Serafimoski Tek

## Ваша ситуација: Постоечки домен

Ако имате домен: `vashdomain.mk`

## Архитектура

```
erp.vashdomain.mk      → Frontend (Cloudflare Pages)
api.vashdomain.mk      → Backend (Railway.app)
```

## Чекор 1: Backend на Railway (бесплатно)

### 1.1 Направете GitHub репозитори
```bash
cd /mnt/agents/output/app
git init
git add .
git commit -m "Initial ERP system"
git branch -M main
```

Направете нов приватен репозитори на github.com и:
```bash
git remote add origin https://github.com/VASHE-KORISNICKO-IME/erp-serafimoski.git
git push -u origin main
```

### 1.2 Креирајте Railway проект
1. Отидете на [railway.app](https://railway.app)
2. Login со GitHub
3. "New Project" → "Deploy from GitHub repo"
4. Одберете го вашиот репозитори
5. Railway автоматски ќе го препознае Node.js проектот

### 1.3 Додадете MySQL база
1. Во Railway проектот → "New" → "Database" → "Add MySQL"
2. Railway автоматски креира база и ја поставува `DATABASE_URL`

### 1.4 Environment Variables
Во Railway → вашиот сервис → "Variables", додадете:
```
DATABASE_URL=${{MySQL.DATABASE_URL}}
JWT_SECRET=(openssl rand -base64 32)
CERT_ENCRYPTION_KEY=(openssl rand -hex 32)
NODE_ENV=production
PORT=3000
```

### 1.5 Deploy
Railway автоматски deploy-ира при секој push на `main`.

Добивате URL: `https://erp-serafimoski-production.up.railway.app`

### 1.6 Поддомен (api.vashdomain.mk)
1. Во Railway → Settings → "Domains"
2. "Custom Domain" → внесете `api.vashdomain.mk`
3. Railway ќе ви даде CNAME запис
4. Во вашиот домен провајдер (МАРФ, Сектор, ГоДеди):
   ```
   Type: CNAME
   Name: api
   Value: (што даде Railway)
   ```

## Чекор 2: Frontend на Cloudflare Pages (веќе деплојиран)

### 2.1 Подесете го API URL-от
Отворете `/mnt/agents/output/app/.env.production`:
```env
VITE_API_URL=https://api.vashdomain.mk/api/trpc
```

### 2.2 Build
```bash
cd /mnt/agents/output/app
npm run build
```

### 2.3 Deploy на Cloudflare Pages
1. Отидете на [dash.cloudflare.com](https://dash.cloudflare.com)
2. Pages → Create a project → Upload assets
3. Upload ја содржината на `dist/public` папката
4. Подесете го поддоменот `erp.vashdomain.mk`

## Чекор 3: Поврзување на домените

### CORS подесувања
Backend-от веќе дозволува сите origins преко `CORS_ORIGIN="*"`.

Ако сакате строга безбедност, сменете во:
```env
CORS_ORIGIN=https://erp.vashdomain.mk
```

## Чекор 4: Пуштање на системот

### Прв пат - seed на податоци
```bash
# На вашиот компјутер:
cd /mnt/agents/output/app
export DATABASE_URL=mysql://...(од Railway)
npx tsx db/seed-metalnet.ts
npx tsx db/seed-defaults.ts
```

### Логин за тестирање
| Улога | Е-маил | Лозинка |
|-------|--------|---------|
| Админ | admin@serafimoski.mk | admin123 |
| Канцеларија | office@serafimoski.mk | office123 |
| Производство | prod@serafimoski.mk | prod123 |
| Магацин | warehouse@serafimoski.mk | warehouse123 |

## Чекор 5: Е-маил за фактури (опционално)

Ако сакате автоматско примање на влезни фактури по е-маил:

Во апликацијата → Подесувања → Фирма → Е-маил IMAP:
- IMAP Сервер: `mail.vashdomain.mk` (или `imap.gmail.com` за Gmail)
- Порт: `993`
- Корисник: `erp@vashdomain.mk`
- Лозинка: (лозинката за е-маилот)

## Чекор 6: УЈП е-Фактура сертификат (опционално)

За испраќање фактури до УЈП со правна важност:
1. Купете квалификуван дигитален сертификат (Семос, Кибермет, КЕП)
2. Во апликацијата → Подесувања → Сертификати
3. Прикачете го PEM сертификатот и приватниот клуч
4. Тестирајте на `efakturatest.ujp.gov.mk`
5. Префрлете на продукција `efaktura.ujp.gov.mk`

## Troubleshooting

### Backend не се поврзува со база
```bash
# Проверете DATABASE_URL
railway logs
```

### Frontend не ја наоѓа API-то
- Проверете `VITE_API_URL` во `.env.production`
- Проверете дали CORS е подесен
- Отворете `https://api.vashdomain.mk/api/trpc/ping` во browser

### SSL/HTTPS проблеми
- Осигурајте се дека и frontend и backend користат HTTPS
- На Cloudflare вклучете "Always Use HTTPS"
