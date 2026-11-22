import type { SVGProps } from "react";

export function RastaMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden {...props}>
      <path fill="currentColor" d="M7 6h19v5H7a2.5 2.5 0 0 1 0-5Zm6 8h13v5H13a2.5 2.5 0 0 1 0-5Zm6 8h7v5h-7a2.5 2.5 0 0 1 0-5Z" />
    </svg>
  );
}
