import type { Meta, StoryObj } from "@storybook/react";
import { Card } from "./Card";
import { Chrome } from "./Chrome";
import { ScreenShell } from "./ScreenShell";

const meta: Meta<typeof ScreenShell> = { component: ScreenShell, title: "ui/ScreenShell" };
export default meta;

export const Bare: StoryObj<typeof ScreenShell> = {
  args: { children: <div className="font-mono text-sm text-matrix-body">// content</div> },
};

export const WithChrome: StoryObj<typeof ScreenShell> = {
  args: {
    chrome: <Chrome title="Dashboard" subtitle="system overview" />,
    children: <div className="font-mono text-sm text-matrix-body">// content</div>,
  },
};

export const WithContent: StoryObj<typeof ScreenShell> = {
  args: {
    chrome: <Chrome title="Agents" subtitle="installed personas" />,
    children: (
      <>
        <Card>
          <span className="font-mono text-sm text-matrix-body">// agent: reviewer</span>
        </Card>
        <Card>
          <span className="font-mono text-sm text-matrix-body">// agent: planner</span>
        </Card>
      </>
    ),
  },
};
