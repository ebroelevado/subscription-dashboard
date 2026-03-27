# Professional Dashboard

A high-performance, modern dashboard built with **Next.js 16**, **Drizzle ORM**, and **AI integration**. This project provides a comprehensive solution for managing subscriptions, analytics, and client interactions with a premium user experience.

## ✨ Features

- **📊 Advanced Analytics**: Real-time data visualization and insights using Recharts.
- **🤖 AI Assistant Tab**: Integrated AI capabilities for intelligent support and automation.
- **💳 Subscription Management**: Full lifecycle management of user plans and seats.
- **🌐 Internationalization**: Multi-language support (ES, EN, ZH) powered by `next-intl`.
- **🔐 Secure Authentication**: Robust auth system via `next-auth`.
- **🛠️ Platform Integration**: Manage and switch between different workspace platforms easily.
- **🕘 Conversation History**: Persistent chat history stored securely in Cloudflare R2 with undo/redo support for AI actions.
- **🌑 Dark/Light Mode**: Beautifully crafted UI with responsive design and theme support.

## 🚀 Tech Stack

- **Framework**: [Next.js 16 (App Router)](https://nextjs.org/)
- **Database**: [Drizzle ORM](https://orm.drizzle.team/) with Cloudflare D1 (SQLite)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) & [Shadcn UI](https://ui.shadcn.com/)
- **AI Engine**: [Vercel AI SDK](https://sdk.vercel.ai/) (OpenAI Compatible)
- **State Management**: [TanStack Query v5](https://tanstack.com/query/latest)
- **Forms**: [React Hook Form](https://react-hook-form.com/) & [Zod](https://zod.dev/)
- **Animation**: [Framer Motion](https://www.framer.com/motion/)
- **i18n**: [Next-Intl](https://next-intl-docs.vercel.app/)
- **Storage**: [Cloudflare R2](https://www.cloudflare.com/developer-platform/r2/) (Conversation History)
- **Deploy**: [Cloudflare Pages](https://pages.cloudflare.com/) with D1

## 🛠️ Getting Started

### Prerequisites

- Node.js >= 22.12.0
- bun (recommended)
- Wrangler CLI (for Cloudflare development)

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/ebroelevado-beep/subscription-dashboard.git
   cd subscription-dashboard
   ```

2. Install dependencies:

   ```bash
   bun install
   ```

3. Set up environment variables:

   Copy `.env.example` to `.env` and fill in the required values (Auth secrets, AI API keys, Stripe keys, etc.).

   **Note:** Database is configured via Cloudflare D1 binding in `wrangler.toml`. No `DATABASE_URL` needed.

### Development Options

#### Option 1: Standard Next.js Development (with local SQLite)

Fastest iteration time. Uses local SQLite database (`local.db`):

```bash
bun dev
```

The database will be created automatically at `./local.db`.

To seed test data:
```bash
bun db:seed
```

#### Option 2: Cloudflare Pages Development (with D1)

Closest to production environment. Uses D1 binding:

```bash
bun run dev:cf
```

This will:
1. Build the app with `@cloudflare/next-on-pages`
2. Run `wrangler pages dev` with D1 binding

**First time setup** - apply migrations to local D1:
```bash
bun run db:migrate:local
```

### Database Management

```bash
# Generate new migrations from schema changes
bun db:generate

# Apply migrations to local D1 database
bun db:migrate:local

# Apply migrations to production D1
bun db:migrate:prod

# Open Drizzle Studio (local SQLite)
bun db:studio

# Seed local database with test data
bun db:seed
```

## 📜 Scripts

- `bun dev`: Starts Next.js development server (with local SQLite fallback)
- `bun dev:cf`: Build and run with Cloudflare Pages (with D1)
- `bun build`: Builds for Cloudflare Pages
- `bun preview`: Preview production build locally with Wrangler
- `bun deploy`: Deploy to Cloudflare Pages
- `bun db:generate`: Generate Drizzle migrations
- `bun db:studio`: Open Drizzle Studio
- `bun db:migrate:local`: Apply migrations to local D1
- `bun db:migrate:prod`: Apply migrations to production D1
- `bun db:seed`: Seed local database with test data
- `bun lint`: Runs ESLint

## 🚀 Deployment

### Cloudflare Pages

1. Create a Cloudflare Pages project:
   ```bash
   npx wrangler pages project create subscription-dashboard
   ```

2. Create D1 database:
   ```bash
   npx wrangler d1 create subscription-dashboard
   ```

3. Update `wrangler.toml` with the D1 `database_id`

4. Configure secrets:
   ```bash
   npx wrangler secret put AUTH_SECRET
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put STRIPE_SECRET_KEY
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```

5. Deploy:
   ```bash
   bun run deploy
   ```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

Built with ❤️ by [ebroelevado-beep](https://github.com/ebroelevado-beep)
