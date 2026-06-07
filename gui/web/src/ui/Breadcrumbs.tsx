import { Link, useLocation, useSearchParams } from "react-router-dom";

interface Crumb {
  label: string;
  to?: string | undefined;
}

function crumbsFor(pathname: string, search: URLSearchParams): Crumb[] {
  const out: Crumb[] = [{ label: "smith", to: "/" }];
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) {
    // root: only "smith", not a link
    out[0] = { label: "smith" };
    return out;
  }
  const [top, ...rest] = parts;

  // Pretty-print helpers
  const pretty = (s: string) => s.replace(/-/g, " ");

  switch (top) {
    case "agents":
      out.push({ label: "agents", to: rest.length ? "/agents" : undefined });
      if (rest[0] === "install-matrix") out.push({ label: "install matrix" });
      else if (rest[0]) {
        const name = rest[0];
        const tab = search.get("tab");
        out.push({ label: name, to: tab ? `/agents/${name}` : undefined });
        if (tab) out.push({ label: pretty(tab) });
      }
      break;
    case "skills":
      out.push({ label: "skills", to: rest.length ? "/skills" : undefined });
      if (rest[0]) out.push({ label: rest[0] });
      break;
    case "catalogs":
      out.push({ label: "catalogs", to: rest.length ? "/catalogs" : undefined });
      break;
    case "knowledge":
      out.push({ label: "knowledge", to: rest.length ? "/knowledge" : undefined });
      if (rest[0] === "refresh-history") out.push({ label: "refresh history" });
      else if (rest[0]) {
        const agent = rest[0];
        if (rest[1] === "refresh-history") {
          out.push({ label: agent, to: `/knowledge/${agent}` });
          out.push({ label: "refresh history" });
        } else {
          out.push({ label: agent });
        }
      }
      break;
    case "system":
      out.push({ label: "system" });
      if (rest[0]) out.push({ label: pretty(rest[0]) });
      break;
    case "onboarding":
      out.push({ label: "onboarding" });
      break;
    default:
      if (top) out.push({ label: top });
  }
  return out;
}

export function Breadcrumbs() {
  const loc = useLocation();
  const [search] = useSearchParams();
  const crumbs = crumbsFor(loc.pathname, search);
  return (
    <nav className="font-mono text-[11px] uppercase tracking-widest text-matrix-green-muted flex gap-1">
      {crumbs.map((c, i) => (
        <span key={c.to ?? `leaf:${c.label}`}>
          {i > 0 && <span className="text-matrix-line mx-1">›</span>}
          {c.to ? (
            <Link to={c.to} className="hover:text-matrix-green">
              {c.label}
            </Link>
          ) : (
            <span className="text-matrix-green">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
