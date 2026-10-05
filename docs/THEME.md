# UI theme (Serafimoski)

Design tokens live in `src/index.css` (`:root` / `.dark`) and are wired through Tailwind in `tailwind.config.js`.

| Token | Role |
|-------|------|
| `--primary` | Brand amber CTA / active chrome |
| `--sidebar-*` | Dark app shell |
| `--success` / `--warning` / `--info` | Semantic badges & status |
| `--header-*` | Top bar |

Prefer `bg-primary`, `text-primary`, and default `Button` variant instead of hardcoded `bg-amber-*`.

Theme toggle (light → dark → system) is in the header; preference key `erp-theme` in `localStorage`. Boot script in `index.html` avoids flash.
