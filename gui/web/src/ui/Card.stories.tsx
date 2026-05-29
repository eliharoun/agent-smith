import type { Meta, StoryObj } from "@storybook/react";
import { Card } from "./Card";

const meta: Meta<typeof Card> = { component: Card, title: "ui/Card" };
export default meta;

export const Plain: StoryObj<typeof Card> = {
  args: { children: "// example card body" },
};

export const WithTitle: StoryObj<typeof Card> = {
  args: {
    children: (
      <>
        <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-2">
          // title
        </div>
        <p className="font-mono text-sm text-matrix-body">Card with header band and body copy.</p>
      </>
    ),
  },
};

export const Dense: StoryObj<typeof Card> = {
  args: {
    className: "p-2",
    children: <span className="font-mono text-xs text-matrix-body">dense padding</span>,
  },
};
