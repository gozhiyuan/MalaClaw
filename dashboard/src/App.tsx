import { Routes, Route, NavLink } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard";
import { Projects } from "./pages/Projects";
import { Starters } from "./pages/Starters";
import { Config } from "./pages/Config";
import { useWs } from "./hooks/useWs";

export function App() {
  useWs();
  const tabs = [
    { to: "/", label: "Overview" },
    { to: "/projects", label: "Projects" },
    { to: "/starters", label: "Starters" },
    { to: "/config", label: "Config" },
  ];

  return (
    <div style={{ minHeight: "100vh" }}>
      <nav style={{
        display: "flex", alignItems: "center", gap: 16,
        background: "#161b22", padding: "8px 16px",
        borderBottom: "1px solid #30363d",
      }}>
        <span style={{ fontWeight: "bold", color: "#f0f6fc", marginRight: 16 }}>
          openclaw-store
        </span>
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === "/"}
            style={({ isActive }) => ({
              padding: "4px 12px", borderRadius: 4, textDecoration: "none",
              color: isActive ? "#58a6ff" : "#8b949e",
              background: isActive ? "#1f6feb33" : "transparent",
            })}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <main style={{ padding: 12 }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/starters" element={<Starters />} />
          <Route path="/config" element={<Config />} />
        </Routes>
      </main>
    </div>
  );
}
