// better-auth configuration types
// This file is kept for backward compatibility during migration
// The actual auth configuration is in auth.ts

// Type augmentation for better-auth session
declare module "better-auth" {
  interface User {
    currency?: string;
    disciplinePenalty?: number;
    companyName?: string | null;
    whatsappUseCompany?: boolean;
    plan?: string;
  }
}
