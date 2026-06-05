import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { useNotifications } from "../hooks/useNotifications";
import { Button } from "./Button";
import { NotificationCenter } from "./NotificationCenter";

/**
 * Stories use the live provider so the stack, dedup, FIFO, mutation, and
 * hover-pause behaviors all work in the addon panel.
 */

const meta: Meta = {
  title: "ui/Notification",
  parameters: { layout: "fullscreen" },
};
export default meta;

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-matrix-black text-matrix-body p-6">
      <NotificationCenter>{children}</NotificationCenter>
    </div>
  );
}

function Demo({
  render,
}: {
  render: (api: ReturnType<typeof useNotifications>) => React.ReactNode;
}) {
  const api = useNotifications();
  return <div className="space-x-2">{render(api)}</div>;
}

export const Success: StoryObj = {
  render: () => (
    <Frame>
      <Demo
        render={(api) => (
          <Button onClick={() => api.notify({ kind: "success", title: "Saved." })}>
            Fire success
          </Button>
        )}
      />
    </Frame>
  ),
};

export const Info: StoryObj = {
  render: () => (
    <Frame>
      <Demo
        render={(api) => (
          <Button
            onClick={() =>
              api.notify({
                kind: "info",
                title: "Saved",
                body: "Re-install required to apply on claude-code, cursor.",
              })
            }
          >
            Fire info with body
          </Button>
        )}
      />
    </Frame>
  ),
};

export const Warning: StoryObj = {
  render: () => (
    <Frame>
      <Demo
        render={(api) => (
          <Button
            onClick={() =>
              api.notify({
                kind: "warning",
                title: "MCP server changes",
                body: "Restart your AI client to pick up updated tools.",
              })
            }
          >
            Fire warning
          </Button>
        )}
      />
    </Frame>
  ),
};

export const ErrorKind: StoryObj = {
  render: () => (
    <Frame>
      <Demo
        render={(api) => (
          <Button
            onClick={() =>
              api.notify({
                kind: "error",
                title: "Refresh failed",
                body: "3 sources could not be re-fetched.",
              })
            }
          >
            Fire error
          </Button>
        )}
      />
    </Frame>
  ),
};

export const Progress: StoryObj = {
  render: () => (
    <Frame>
      <Demo
        render={(api) => (
          <Button
            onClick={() => api.notify({ kind: "progress", title: "Re-installing claude-code…" })}
          >
            Fire progress
          </Button>
        )}
      />
    </Frame>
  ),
};

export const WithActions: StoryObj = {
  render: () => (
    <Frame>
      <Demo
        render={(api) => (
          <Button
            onClick={() =>
              api.notify({
                kind: "info",
                title: "Saved",
                body: "Re-install required to apply on claude-code, cursor.",
                durationMs: "sticky",
                actions: [
                  {
                    label: "Re-install now",
                    onClick: () => console.log("reinstall"),
                  },
                  {
                    label: "Dismiss",
                    variant: "ghost",
                    onClick: () => console.log("dismiss"),
                  },
                ],
              })
            }
          >
            Fire actionable info
          </Button>
        )}
      />
    </Frame>
  ),
};

function MutationDemoInner() {
  const api = useNotifications();
  const [id, setId] = useState<string | null>(null);
  return (
    <div className="space-x-2">
      <Button
        onClick={() => {
          const newId = api.notify({ kind: "progress", title: "Re-installing claude-code…" });
          setId(newId);
        }}
      >
        Start progress
      </Button>
      <Button
        variant="ghost"
        disabled={!id}
        onClick={() => {
          if (!id) return;
          api.update(id, { kind: "success", title: "Re-installed" });
          setId(null);
        }}
      >
        Finish (success)
      </Button>
      <Button
        variant="danger"
        disabled={!id}
        onClick={() => {
          if (!id) return;
          api.update(id, { kind: "error", title: "Re-install failed" });
          setId(null);
        }}
      >
        Finish (error)
      </Button>
    </div>
  );
}

export const Mutation: StoryObj = {
  render: () => (
    <Frame>
      <MutationDemoInner />
    </Frame>
  ),
};

export const Dedup: StoryObj = {
  render: () => (
    <Frame>
      <Demo
        render={(api) => (
          <Button
            onClick={() => {
              api.notify({
                kind: "info",
                title: "Saved",
                dedupKey: "agent-saved",
                durationMs: "sticky",
              });
              api.notify({
                kind: "info",
                title: "Saved (again)",
                dedupKey: "agent-saved",
                durationMs: "sticky",
              });
            }}
          >
            Fire twice (dedup)
          </Button>
        )}
      />
    </Frame>
  ),
};
