# Pearfect Dashboard

Dashboard de gestión de suscripciones, análisis y clientes para **Pearfect S.L.** — construido con Next.js 16, React 19, Prisma 7 y AWS S3. Incluye asistente IA, internacionalización y autenticación robusta.

## ✨ Características

- **📊 Analytics avanzados**: Visualización de datos en tiempo real con Recharts.
- **🤖 Asistente IA**: Integración de IA con historial de conversación persistente vía AWS S3.
- **💳 Gestión de suscripciones**: Ciclo de vida completo de planes, usuarios y seats.
- **🌐 Internacionalización**: Soporte multiidioma (ES, EN, ZH) con `next-intl`.
- **🔐 Autenticación segura**: Sistema de auth con `next-auth v5` + Prisma Adapter.
- **🌑 Dark / Light Mode**: UI con tema dinámico y diseño completamente responsivo.
- **📋 Tablas avanzadas**: TanStack Table v8 para listados y gestión de datos.
- **⚡ Animaciones**: Transiciones fluidas con Framer Motion.

## 🚀 Tech Stack

| Área | Tecnología |
|---|---|
| **Framework** | [Next.js 16.1.6 (App Router)](https://nextjs.org/) |
| **Runtime / UI** | [React 19.2](https://react.dev/) |
| **Lenguaje** | TypeScript 5 |
| **Base de datos** | PostgreSQL + [Prisma ORM 7](https://www.prisma.io/) |
| **Estilos** | [Tailwind CSS 4](https://tailwindcss.com/) + [Shadcn/UI](https://ui.shadcn.com/) + Radix UI |
| **IA / LLM** | [Vercel AI SDK 6](https://sdk.vercel.ai/) (`@ai-sdk/openai`, `@ai-sdk/react`) |
| **Storage** | [AWS S3](https://aws.amazon.com/s3/) (`@aws-sdk/client-s3`) |
| **Auth** | [NextAuth v5](https://authjs.dev/) + Prisma Adapter |
| **Estado / Datos** | [TanStack Query v5](https://tanstack.com/query) + [TanStack Table v8](https://tanstack.com/table) |
| **Formularios** | [React Hook Form 7](https://react-hook-form.com/) + [Zod 4](https://zod.dev/) |
| **Animaciones** | [Framer Motion 12](https://www.framer.com/motion/) |
| **Gráficas** | [Recharts 3](https://recharts.org/) |
| **i18n** | [next-intl 4](https://next-intl-docs.vercel.app/) |
| **Notificaciones** | [Sonner 2](https://sonner.emilkowal.ski/) |
| **Package manager** | [Bun 1.3.10](https://bun.sh/) |

## 🛠️ Primeros pasos

### Requisitos

- Node.js >= 22.12.0
- Bun >= 1.3.10

### Instalación

```bash
# 1. Clona el repositorio
git clone https://github.com/ebroelevado/subscription-dashboard.git
cd subscription-dashboard

# 2. Instala dependencias
bun install

# 3. Configura variables de entorno
cp .env.example .env.local
# Rellena DATABASE_URL, AUTH_SECRET, claves de API de IA y credenciales AWS S3

# 4. Inicializa la base de datos
bun x prisma generate
bun x prisma migrate dev
```

### Desarrollo

```bash
bun dev
```

Abre [http://localhost:3000](http://localhost:3000) en el navegador.

## 📜 Scripts

| Comando | Descripción |
|---|---|
| `bun dev` | Servidor de desarrollo |
| `bun build` | Build de producción (genera Prisma client) |
| `bun start` | Servidor de producción (ejecuta migraciones) |
| `bun lint` | ESLint |

---

Built with ❤️ by [ebroelevado](https://github.com/ebroelevado) · [pearfect.net](https://pearfect.net)
