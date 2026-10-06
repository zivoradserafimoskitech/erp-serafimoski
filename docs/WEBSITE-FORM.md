# Форма „Побарај понуда“ на serafimoski.tech → ERP

Барањата од веб-страницата одат директно во ERP → **Маркетинг → Барања**: со изворот (Google Ads, Facebook…),
кампањата, прилозите (цртежи) и согласноста за маркетинг. Од таму со еден клик: купувач + нацрт-понуда,
а изворот/кампањата се пренесуваат понуда → нарачка → фактура (за извештај „приход по кампања“).

## Адреса

```
POST https://<ERP-домен>/api/public/lead
```

Сега ERP-то е на `https://web-production-dceb8.up.railway.app` — ако се смени доменот, смени го `ENDPOINT` / `action` во формата.

CORS: `https://serafimoski.tech` и `https://www.serafimoski.tech` се секогаш дозволени. Други домени (staging, локален развој)
→ env `ALLOWED_ORIGINS=https://staging.serafimoski.tech,http://localhost:5174`.

## Готови форми

| Датотека | Кога |
|---|---|
| [`docs/website-form/LeadForm.tsx`](website-form/LeadForm.tsx) + [`attribution.ts`](website-form/attribution.ts) | Страницата е React (Vite + React 19, hash рутирање) — копирај ги двете датотеки во `src/`. |
| [`docs/website-form/lead-form.html`](website-form/lead-form.html) | Било која HTML страница / Hostinger builder — залепи го целиот блок. Работи и без JavaScript. |

React:

```tsx
// main.tsx — еднаш при вчитување, за да се запамти од каде дошол посетителот
import { captureAttribution } from "./attribution";
captureAttribution();

// на страницата Контакт
import LeadForm from "./LeadForm";
<LeadForm lang="mk" />   // или lang="en"
```

`captureAttribution()` ги чита `utm_*`, `gclid`, `fbclid` и пред и по `#` (на пр. `https://serafimoski.tech/#/kontakt?utm_source=google`),
ги чува 90 дена во `localStorage` (последен недиректен извор) заедно со првата страница и referrer-от, па барањето што ќе се прати
подоцна (по разгледување на неколку страници) сепак ја носи кампањата.

## Полиња

`multipart/form-data` (препорачано, со датотеки) или `application/json` (датотеки како base64 во `files: [{ name, mime, data }]`).

| Поле | Задолжително | Забелешка |
|---|---|---|
| `name` | да | мин. 2 знаци |
| `email` | да | |
| `company`, `phone` | | |
| `product_type`, `quantity`, `message` | | ако `product_type` = име/код на производ во ERP, понудата добива ставка со јавната цена |
| `files` (повеќе) | | PDF, DXF, DWG, STEP/STP, IGES, PNG, JPG; најмногу 5 датотеки, 10 MB секоја, 25 MB вкупно |
| `marketing_consent` | | `on`/`true` = согласност за маркетинг е-пошта (се чува со датум) |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `gclid`, `fbclid`, `landing_page`, `referrer` | | од `attribution.ts` |
| `lang` | | `mk` / `en` |
| `website` | **празно** | honeypot — ако е пополнето, одговорот е „ok“ но ништо не се зачувува |
| `_ts` | препорачано | `Date.now()` кога формата е прикажана; пополнето за < 2,5 s = спам |
| `_redirect` | | само за обична HTML форма: 303 кон оваа адреса (мора да е дозволен домен) со `?lead=ok` / `?lead=error` |

Одговори: `200 {"ok":true,"id":123}` · `400 {"ok":false,"error":"…"}` (порака на македонски, за прикажување) ·
`413` преголеми прилози · `429` повеќе од 5 барања за 10 мин од иста IP (`LEAD_RATE_LIMIT`).

## Што се случува по барањето

1. Се зачувува со каналот: `gclid` или google+cpc → *Google Ads*; facebook/instagram со `utm_medium=paid_social|cpc` → *реклами*;
   само `fbclid` или referrer од Facebook → *Facebook*; google.com referrer → *Google (органско)*; без ништо → *Директно*.
2. Ѕвонче во ERP + (опционално) е-пошта до адресите во **Барања → Поставки** (на пр. andrej@serafimoski.tech).
3. Автоматски одговор до клиентот од шаблон (Барања → Поставки), ако е поставена е-пошта за праќање (SMTP / `MAIL_PROVIDER`).
4. Сомнителни барања (пребрзо, многу линкови) се чуваат со статус *Спам* без известување.

## UTM за рекламите

- **Google Ads**: вклучи *auto-tagging* (gclid) — доволно. Опционално Final URL suffix: `utm_source=google&utm_medium=cpc&utm_campaign={campaignid}`.
- **Meta (Facebook/Instagram)**: URL parameters: `utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}`
  (без `utm_medium=paid_social` рекламата ќе се брои како органски Facebook — `fbclid` го има и на органски објави).
- **Е-пошта / понуди**: `utm_source=newsletter&utm_medium=email&utm_campaign=<име>`.

## Конверзии (опционално)

Формата повикува `gtag("event", "generate_lead")` и `fbq("track", "Lead")` ако на страницата се вчитани Google tag / Meta Pixel
— треба GA4 / Google Ads и Meta Business сметки (не се дел од ERP-то).

## Product feed (Meta / Google Merchant)

ERP → **Маркетинг → Веб каталог**: означи производи „на веб“, внеси https линк, слика, јавна цена и опис. Адреси:

```
https://<ERP-домен>/api/public/feed/meta.csv     (Meta Commerce Manager → Data feed, scheduled)
https://<ERP-домен>/api/public/feed/google.xml   (Google Merchant Center → Feeds → Scheduled fetch)
```

Со `FEED_TOKEN` поставен, додај `?key=<FEED_TOKEN>`.

## Проверка

```bash
curl -i -X POST https://<ERP-домен>/api/public/lead \
  -H "Origin: https://serafimoski.tech" \
  -F name="Тест Тестовски" -F email=test@example.com -F product_type="Ласерско сечење" \
  -F utm_source=google -F utm_medium=cpc -F utm_campaign=test -F _ts=$(( $(date +%s%3N) - 10000 )) \
  -F files=@crtez.pdf
```
