# CloudCrane Frontend Architecture v1

- Locales are `en` (default, no prefix) and `zh` (`/zh`), configured by `next-intl`.
- Marketing routes live under `[locale]/(marketing)`; product routes under `[locale]/(product)/app`; the Agent workbench lives under `[locale]/(workbench)/app`.
- `MarketingLayout`, `AppShell`, and `WorkbenchShell` are separate boundaries. Business UI belongs in feature folders; primitives belong in `components/ui`.
- `globals.css` owns reset, baseline, and CloudCrane tokens. Page-specific styles remain near their feature during this foundation phase.
- API routes remain outside `[locale]` and are excluded from the next-intl proxy matcher.
