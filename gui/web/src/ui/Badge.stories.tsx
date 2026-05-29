import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "./Badge";

const meta: Meta<typeof Badge> = { component: Badge, title: "ui/Badge" };
export default meta;

export const Version: StoryObj<typeof Badge> = { args: { children: "v0.22.0" } };
export const Count: StoryObj<typeof Badge> = { args: { children: "3 agents" } };
export const Label: StoryObj<typeof Badge> = { args: { children: "phase 1" } };
