import { NavLink } from "react-router-dom";
import { AsciiGlyph } from "./AsciiGlyph";

const SECTIONS = [
  {
    label: "construct",
    items: [
      { to: "/", glyph: "dashboard", label: "Dashboard" },
      { to: "/agents", glyph: "agents", label: "Agents" },
      { to: "/skills", glyph: "skills", label: "Skills" },
      { to: "/catalogs", glyph: "catalog", label: "Catalogs" },
    ],
  },
  {
    label: "knowledge",
    items: [
      { to: "/knowledge", glyph: "sources", label: "Sources" },
      { to: "/knowledge/refresh-history", glyph: "refresh", label: "Refresh History" },
      { to: "/system/atlassian-setup", glyph: "atlassian", label: "Atlassian Setup" },
    ],
  },
  {
    label: "system",
    items: [
      { to: "/system/model-config", glyph: "settings", label: "Model Config" },
      { to: "/system/doctor", glyph: "doctor", label: "Doctor" },
      { to: "/system/daemon", glyph: "daemon", label: "Daemon" },
      { to: "/system/update", glyph: "update", label: "Update" },
      { to: "/system/history", glyph: "history", label: "History" },
      { to: "/system/settings", glyph: "settings", label: "Settings" },
      { to: "/system/jack-out", glyph: "jack-out", label: "Jack Out" },
    ],
  },
];

export function AppNav() {
  return (
    <aside className="w-52 border-r border-matrix-line bg-black/60 p-3 space-y-6">
      {SECTIONS.map((s) => (
        <div key={s.label}>
          <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-2">
            // {s.label}
          </div>
          <ul className="space-y-1">
            {s.items.map((it) => (
              <li key={it.to}>
                <NavLink
                  to={it.to}
                  end={it.to === "/"}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-2 py-1 font-mono text-xs uppercase tracking-wider transition-colors ${
                      isActive
                        ? "text-matrix-green shadow-matrix-glow"
                        : "text-matrix-body hover:text-matrix-green"
                    }`
                  }
                >
                  <AsciiGlyph name={it.glyph} className="text-base" />
                  {it.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </aside>
  );
}
