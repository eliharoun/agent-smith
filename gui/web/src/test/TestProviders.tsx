// gui/web/src/test/TestProviders.tsx
//
// Shared test wrapper that supplies the contexts most components need:
// React Query and React Router. Each test gets a fresh QueryClient (no
// cross-test cache bleed) and a MemoryRouter so `useNavigate` / `<Link>`
// don't blow up.
//
// Use this for component tests that don't need to assert on specific routes;
// when you need particular initial entries pass them via `routerEntries`.
// For tests that don't need routing, this still works fine — the router
// is inert.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

interface Props {
  children: ReactNode;
  routerEntries?: string[];
}

export function TestProviders({ children, routerEntries }: Props) {
  // Fresh QueryClient per render keeps tests independent.
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter {...(routerEntries ? { initialEntries: routerEntries } : {})}>
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  );
}
