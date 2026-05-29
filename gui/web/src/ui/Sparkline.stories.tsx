import type { Meta, StoryObj } from "@storybook/react";
import { Sparkline } from "./Sparkline";

const meta: Meta<typeof Sparkline> = { component: Sparkline, title: "ui/Sparkline" };
export default meta;

export const Trending: StoryObj<typeof Sparkline> = {
  args: { values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
};

export const Flat: StoryObj<typeof Sparkline> = {
  args: { values: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5] },
};

export const Volatile: StoryObj<typeof Sparkline> = {
  args: { values: [2, 8, 1, 9, 3, 7, 2, 9, 4, 6] },
};
