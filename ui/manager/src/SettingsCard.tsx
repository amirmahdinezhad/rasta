import type { ReactNode } from "react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";

export function SettingsCard({ id, title, description, children }: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <Card className="h-full gap-3 rounded-2xl p-4 shadow-(--shadow-panel)">
        <CardContent className="space-y-1 px-0">
          <h3 id={id} className="text-sm font-semibold">{title}</h3>
          <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
        </CardContent>
        <CardFooter className="mt-auto min-h-10 justify-between gap-2 px-0">
          {children}
        </CardFooter>
      </Card>
    </section>
  );
}
