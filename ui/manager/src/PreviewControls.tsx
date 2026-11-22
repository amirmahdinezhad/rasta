import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

// This surface controls browser-only fixtures; it never calls a native service.
export function PreviewControls({
  refresh,
  clearFailure,
}: {
  refresh: () => Promise<unknown>;
  clearFailure: (id: string) => void;
}) {
  const control = window.rastaPreviewControl!;
  const [, render] = useState(0);
  const scenario = control.scenario?.() || "normal";
  const failure = control.failure();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="fixed right-5 bottom-2 z-30 rounded-full bg-popover text-[11px] text-muted-foreground"
        >
          UI preview · Simulated
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>Preview tools</DialogTitle>
          <DialogDescription>
            All installations, downloads and removals are simulated. Installed
            apps and their data are untouched.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="min-h-0 [&>[data-slot=scroll-area-viewport]]:max-h-[60dvh]">
          <div className="flex flex-wrap items-center gap-4 p-6 text-xs text-muted-foreground">
            <Button asChild variant="outline" size="sm">
              <a href="/panel-preview">Open panel preview</a>
            </Button>
            <div className="flex items-center gap-2">
              <Label htmlFor="preview-scenario" className="text-xs">
                T3 scenario
              </Label>
              <Select
                value={scenario}
                onValueChange={(value) => {
                  if (value === scenario) return;
                  control.setScenario?.(value);
                  clearFailure("t3");
                  render((value) => value + 1);
                  void refresh();
                }}
              >
                <SelectTrigger id="preview-scenario" className="w-48 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    ["normal", "Ready to install"],
                    ["host-recovery", "Host update recovery"],
                    ["old-runtime", "Older saved installer"],
                    ["app-update", "T3 update required"],
                    ["rasta-update", "Waiting for Rasta release"],
                    ["offline", "Update check failed"],
                    ["verification", "Invalid download"],
                    ["disk-space", "Insufficient disk space"],
                  ].map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="preview-core-update" className="text-xs">
                Offer a Rasta app update
              </Label>
              <Switch
                id="preview-core-update"
                checked={control.coreOffer()}
                onCheckedChange={(value) => {
                  control.setCoreOffer(value);
                  render((count) => count + 1);
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="preview-download-error" className="text-xs">
                Download error
              </Label>
              <Switch
                id="preview-download-error"
                checked={failure}
                onCheckedChange={(value) => {
                  control.setFailure(value);
                  render((value) => value + 1);
                }}
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => control.reset()}>
              Reset demo
            </Button>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
