import { longWriteClientExtension } from "./longwrite";
import type { DashboardClientExtension } from "./types";

/** Client-side product integrations. The core dashboard shell only knows about
 *  this generic extension shape. */
export const dashboardClientExtensions: DashboardClientExtension[] = [
  longWriteClientExtension,
];
