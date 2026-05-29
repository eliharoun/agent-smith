import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button";

const meta: Meta<typeof Button> = { component: Button, title: "ui/Button" };
export default meta;

export const Primary: StoryObj<typeof Button> = { args: { children: "Install" } };
export const Ghost: StoryObj<typeof Button> = { args: { children: "Cancel", variant: "ghost" } };
export const Danger: StoryObj<typeof Button> = { args: { children: "Destroy", variant: "danger" } };
