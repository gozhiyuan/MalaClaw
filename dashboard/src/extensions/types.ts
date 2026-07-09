import type { ReactNode } from "react";

export type DashboardClientExtension = {
  id: string;
  label: string;
  path: string;
  element: ReactNode;
};
