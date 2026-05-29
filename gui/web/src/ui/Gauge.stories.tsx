import type { Meta, StoryObj } from "@storybook/react";
import { Gauge } from "./Gauge";

const meta: Meta<typeof Gauge> = { component: Gauge, title: "ui/Gauge" };
export default meta;

export const Low: StoryObj<typeof Gauge> = { args: { value: 15, label: "low" } };
export const Mid: StoryObj<typeof Gauge> = { args: { value: 50, label: "mid" } };
export const High: StoryObj<typeof Gauge> = { args: { value: 95, label: "high" } };
