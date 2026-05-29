import type { Meta, StoryObj } from "@storybook/react";
import { Lamp } from "./Lamp";

const meta: Meta<typeof Lamp> = { component: Lamp, title: "ui/Lamp" };
export default meta;

export const On: StoryObj<typeof Lamp> = { args: { status: "on", label: "online" } };
export const Warn: StoryObj<typeof Lamp> = { args: { status: "warn", label: "degraded" } };
export const Off: StoryObj<typeof Lamp> = { args: { status: "off", label: "offline" } };
export const Errored: StoryObj<typeof Lamp> = { args: { status: "error", label: "failed" } };
