import type { ScopedThreadRef } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "~/rpc/atomRegistry";

/** The thread whose summary dialog is open; the sidebar, thread menu, and palette all open it. */
export const threadSummaryDialogThreadAtom = Atom.make<ScopedThreadRef | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("thread-summary:dialog-thread"),
);

export function openThreadSummaryDialog(threadRef: ScopedThreadRef): void {
  appAtomRegistry.set(threadSummaryDialogThreadAtom, threadRef);
}
