import type { LucideIcon } from "lucide-react";
import { Scale, Telescope, Wallet } from "lucide-react";

export type ShellNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Page title in the header when it differs from the label. */
  title?: string;
  /** Heading the item sits under. Used only when the app has more than six items. */
  group?: string;
  /** Other path prefixes that keep this item highlighted, such as detail pages. */
  match?: string[];
  /** Primary action shown at the right of the page header. */
  action?: { label: string; href: string };
};

/** The only part of the sidebar shell that differs between looot apps. */
export const SHELL = {
  name: "looot-lookalike",
  repoUrl: "https://github.com/loootai/looot-lookalike",
  docsUrl: "https://docs.looot.ai",
  nav: <ShellNavItem[]>[
    { href: "/", label: "Lookalikes", title: "Lookalike companies", icon: Telescope, action: { label: "New search", href: "/#seeds-h" } },
    { href: "/scoring", label: "Scoring and spend", icon: Scale },
    { href: "/costs", label: "Costs", title: "Costs and budget", icon: Wallet },
  ],
};
