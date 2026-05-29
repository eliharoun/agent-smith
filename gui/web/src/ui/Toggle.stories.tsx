import type { Meta, StoryObj } from "@storybook/react";
import { Toggle } from "./Toggle";

const meta: Meta<typeof Toggle> = { component: Toggle, title: "ui/Toggle" };
export default meta;

export const Checked: StoryObj<typeof Toggle> = {
  args: { checked: true, label: "Daemon", onChange: () => {} },
};

export const Unchecked: StoryObj<typeof Toggle> = {
  args: { checked: false, label: "Daemon", onChange: () => {} },
};

export const Disabled: StoryObj<typeof Toggle> = {
  args: { checked: true, label: "Daemon", disabled: true, onChange: () => {} },
};
