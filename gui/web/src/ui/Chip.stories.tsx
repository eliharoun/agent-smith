import type { Meta, StoryObj } from "@storybook/react";
import { Chip } from "./Chip";

const meta: Meta<typeof Chip> = { component: Chip, title: "ui/Chip" };
export default meta;

export const Neutral: StoryObj<typeof Chip> = { args: { children: "opencode", tone: "neutral" } };
export const Green: StoryObj<typeof Chip> = { args: { children: "installed", tone: "green" } };
export const Amber: StoryObj<typeof Chip> = { args: { children: "pending", tone: "amber" } };
export const Red: StoryObj<typeof Chip> = { args: { children: "failed", tone: "red" } };
