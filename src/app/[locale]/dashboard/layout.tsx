import { cookies } from "next/headers";
import { DashboardShell } from "@/components/dashboard-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Wrap cookies() in try/catch for Vinext compatibility
  // next/headers cookies() requires Next.js request context
  // which Vinext may not fully polyfill
  let defaultCollapsed = false;
  try {
    const cookieStore = await cookies();
    defaultCollapsed = cookieStore.get("sidebar-collapsed")?.value === "1";
  } catch (e) {
    console.warn("cookies() failed in Vinext, using default sidebar state");
  }

  return (
    <DashboardShell defaultCollapsed={defaultCollapsed}>
      {children}
    </DashboardShell>
  );
}
