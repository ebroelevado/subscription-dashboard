# Professional Dashboard

A high-performance, modern dashboard built with **Next.js 16**, **React 19**, **Drizzle ORM**, **Better Auth**, and **AI integration**. This project provides a comprehensive solution for managing subscriptions, analytics, and client interactions with a premium user experience.

## ✨ Features

- **📊 Advanced Analytics**: Real-time data visualization and insights using Recharts.
- **🤖 AI Assistant Tab**: Integrated AI capabilities for intelligent support and automation.
- **💳 Subscription Management**: Full lifecycle management of user plans and seats.
- **🌐 Internationalization**: Multi-language support (ES, EN, ZH) powered by `next-intl`.
- **🔐 Secure Authentication**: Robust auth system via `better-auth`.
- **🛠️ Platform Integration**: Manage and switch between different workspace platforms easily.
- **🕘 Conversation History**: Persistent chat history stored securely in Cloudflare R2 with undo/redo support for AI actions.
- **🌑 Dark/Light Mode**: Beautifully crafted UI with responsive design and theme support.

## 🚀 Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org/) with App Router and React 19
- **Database**: [Drizzle ORM](https://orm.drizzle.team/) with Cloudflare D1 (SQLite)
- **Authentication**: [Better Auth](https://better-auth.com/) with email/password and Google OAuth
- **Styling**: [Tailwind CSS 4](https://tailwindcss.com/) & [Shadcn UI](https://ui.shadcn.com/)
- **AI Engine**: [Vercel AI SDK](https://sdk.vercel.ai/) plus OpenAI-compatible providers
- **State Management**: [TanStack Query v5](https://tanstack.com/query/latest) and [TanStack Table](https://tanstack.com/table/latest)
- **Forms**: [React Hook Form](https://react-hook-form.com/) & [Zod](https://zod.dev/)
- **Animation**: [Framer Motion](https://www.framer.com/motion/)
- **i18n**: [next-intl](https://next-intl.dev/)
- **Storage**: [Cloudflare R2](https://www.cloudflare.com/developer-platform/r2/) (Conversation History)
- **Deployment**: [Cloudflare Pages](https://pages.cloudflare.com/) with D1
- **Runtime**: Bun, Vite, and Wrangler for local development and deployment workflows

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

#### Option 1: Local Next.js Development (with local SQLite)

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

#### Option 3: Vinext Development

Use the Vite-based runtime when you want the project's alternate dev server:

```bash
bun run dev:vinext
```

For a production-like local start, use:

```bash
bun run start
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

- `bun dev`: Starts the local Next.js development server
- `bun dev:cf`: Build and run with Cloudflare Pages and D1
- `bun dev:do`: Run the agent-session worker locally with Wrangler
- `bun deploy:do`: Deploy the agent-session worker to Cloudflare Workers
- `bun build`: Builds for Cloudflare Pages
- `bun build:vinext`: Build the Vinext app with Vite
- `bun preview`: Preview the production build locally with Wrangler
- `bun deploy`: Deploy to Cloudflare Pages
- `bun db:generate`: Generate Drizzle migrations
- `bun db:studio`: Open Drizzle Studio
- `bun db:migrate:local`: Apply migrations to local D1
- `bun db:migrate:prod`: Apply migrations to production D1
- `bun auth:check`: Check and repair auth accounts
- `bun auth:repair`: Repair auth accounts in place
- `bun db:seed`: Seed local database with test data
- `bun db:migrate:pg-to-d1`: Migrate PostgreSQL data into D1
- `bun dev:vinext`: Run the Vinext dev server on port 3000
- `bun lint`: Runs ESLint
- `bun test`, `bun test:all`, `bun test:watch`: Run the test suite
- `bun test:ai`, `bun test:mutations`, `bun test:services`: Run focused test groups

## 🚀 Deployment

### Cloudflare Pages

The production deployment target is Cloudflare Pages with a D1 database binding.


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
