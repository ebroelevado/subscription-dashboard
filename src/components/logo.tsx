import { useId } from "react";

interface LogoProps {
  size?: number;
  className?: string;
}

export function Logo({ size = 32, className = "" }: LogoProps) {
  const aluminumId = useId().replace(/:/g, "");
  const obsidianId = useId().replace(/:/g, "");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Pearfect S.L. logo"
    >
      <defs>
        <linearGradient id={aluminumId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="50%" stopColor="#E5E7EB" />
          <stop offset="100%" stopColor="#D1D5DB" />
        </linearGradient>
        <linearGradient id={obsidianId} x1="16" y1="12" x2="16" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3F3F46" />
          <stop offset="50%" stopColor="#18181B" />
          <stop offset="100%" stopColor="#09090B" />
        </linearGradient>
      </defs>
      {/* Background: Dark in light mode, Metallic Aluminum in dark mode */}
      <rect 
        width="48" 
        height="48" 
        rx="12" 
        fill="#18181B"
        style={{ fill: `var(--bg-fill)` }}
        className={`fill-[#18181B] dark:fill-[url(#${aluminumId})]`}
      />
      {/* Lines: White in light mode, Metallic Obsidian in dark mode */}
      <g fill="none" strokeWidth="2.5" strokeLinecap="round" className={`stroke-white dark:stroke-[url(#${obsidianId})]`}>
        {/* Vertical bar of P */}
        <line x1="16" y1="12" x2="16" y2="36" />
        {/* P curve */}
        <path d="M16 12 H28 C33 12 33 22 28 22 H16" />
        {/* Ledger lines */}
        <line x1="20" y1="28" x2="34" y2="28" opacity="0.6" />
        <line x1="20" y1="32" x2="30" y2="32" opacity="0.4" />
        <line x1="20" y1="36" x2="26" y2="36" opacity="0.25" />
      </g>
    </svg>
  );
}

export function LogoMark({ size = 20, className = "" }: LogoProps) {
  const aluminumId = useId().replace(/:/g, "");
  const obsidianId = useId().replace(/:/g, "");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Pearfect S.L."
    >
      <defs>
        <linearGradient id={aluminumId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="50%" stopColor="#E5E7EB" />
          <stop offset="100%" stopColor="#D1D5DB" />
        </linearGradient>
        <linearGradient id={obsidianId} x1="16" y1="12" x2="16" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3F3F46" />
          <stop offset="50%" stopColor="#18181B" />
          <stop offset="100%" stopColor="#09090B" />
        </linearGradient>
      </defs>
      <rect 
        width="48" 
        height="48" 
        rx="12" 
        fill="#18181B"
        className={`fill-[#18181B] dark:fill-[url(#${aluminumId})]`}
      />
      <g fill="none" strokeWidth="2.5" strokeLinecap="round" className={`stroke-white dark:stroke-[url(#${obsidianId})]`}>
        <line x1="16" y1="12" x2="16" y2="36" />
        <path d="M16 12 H28 C33 12 33 22 28 22 H16" />
        <line x1="20" y1="28" x2="34" y2="28" opacity="0.6" />
        <line x1="20" y1="32" x2="30" y2="32" opacity="0.4" />
        <line x1="20" y1="36" x2="26" y2="36" opacity="0.25" />
      </g>
    </svg>
  );
}
