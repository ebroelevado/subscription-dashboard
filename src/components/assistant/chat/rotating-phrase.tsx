import { useState, useEffect } from "react";

export function RotatingPhrase({ phrases, intervalMs = 2500 }: { phrases: string[]; intervalMs?: number }) {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (phrases.length <= 1) return;
    let current = 0;
    const tick = setInterval(() => {
      // Fade out
      setVisible(false);
      setTimeout(() => {
        current = (current + 1) % phrases.length;
        setIdx(current);
        // Fade in
        setVisible(true);
      }, 280);
    }, intervalMs);
    return () => clearInterval(tick);
  }, [phrases, intervalMs]);

  return (
    <span
      style={{
        display: 'inline-block',
        transition: 'opacity 0.25s ease, transform 0.25s ease',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(-6px)',
      }}
    >
      {phrases[idx]}
    </span>
  );
}
