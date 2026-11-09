import {
  CEO_THREAD_TAG,
  hasCeoThreadTag,
  isCeoThreadTag,
  type ScopedThreadRef,
} from "@t3tools/contracts";

import { cn } from "~/lib/utils";
import { useThreadShell } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Experimental: tags the thread `ceo` so each finished turn gets a CEO side chat. */
export function CeoToggle({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const thread = useThreadShell(threadRef);
  const setTag = useOrchestrationCommand(threadEnvironment.setTag, { label: "toggle CEO review" });
  if (
    thread === null ||
    thread.lineage.sideChat === true ||
    thread.lineage.relationshipToParent === "subagent"
  ) {
    return null;
  }
  const on = hasCeoThreadTag(thread.source.tags);
  const toggle = () => {
    // Untagging clears every spelling an agent may have used, like "CEO".
    const tags = on ? (thread.source.tags ?? []).filter(isCeoThreadTag) : [CEO_THREAD_TAG];
    for (const tag of tags) {
      void setTag({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, tag, tagged: !on },
      });
    }
  };
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-pressed={on}
            aria-label={on ? "Turn off CEO review" : "Turn on CEO review"}
            onClick={toggle}
            className={cn(
              "inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md border px-1.5 text-2xs font-semibold tracking-wide transition-colors [-webkit-app-region:no-drag] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              on
                ? "border-ceo/60 bg-ceo/12 text-ceo-foreground hover:bg-ceo/20"
                : "border-border text-muted-foreground hover:border-ceo/50 hover:text-ceo-foreground",
            )}
          />
        }
      >
        <span
          aria-hidden
          className={cn("size-1.5 rounded-full", on ? "bg-ceo" : "bg-muted-foreground/40")}
        />
        CEO
      </TooltipTrigger>
      <TooltipPopup side="bottom" className="max-w-72 whitespace-normal">
        {on
          ? "CEO review is on (experimental). After each finished turn, an Opus 5.5 side chat reads a cleaned summary of this thread and proposes the next prompt. Click to turn off."
          : "Experimental: after each finished turn, an Opus 5.5 side chat reads a cleaned summary of this thread, with its next-step ideas removed, and proposes the next prompt."}
      </TooltipPopup>
    </Tooltip>
  );
}
