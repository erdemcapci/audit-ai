export function Badge({ children, tone = "neutral" }: { children: string; tone?: "neutral" | "blue" | "amber" | "green" | "red" | "purple" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
