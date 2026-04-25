// better-auth configuration types
// This file is kept for backward compatibility during migration
// The actual auth configuration is in auth.ts

// Type augmentation for better-auth session
declare module "better-auth" {
  interface User {
    currency?: string;
    plan?: string;
  }
}
