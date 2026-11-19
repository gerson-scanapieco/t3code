import { createThreadSummaryEnvironmentAtoms } from "@t3tools/client-runtime/state/thread-summaries";

import { connectionAtomRuntime } from "../connection/runtime";

export const threadSummaryEnvironment = createThreadSummaryEnvironmentAtoms(connectionAtomRuntime);
