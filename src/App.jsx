import { useState, useMemo } from "react";
import { groupFiles } from "./logic/groupFiles";
import { getGroupColor } from "./logic/colors";
import "./FadeItem.css";

function FadeItem({ children, style, group, delay }) {
  const color = getGroupColor(group);

  return (
    <div
      className="fade-item"
      style={{
        ...style,
        "--halo-color": color,
        boxShadow: `0 0 0 6px ${color}`,
        animation: `
          fadeInSoft 0.5s ease ${delay}ms forwards,
          pulseHalo 2.4s ease-in-out ${delay + 500}ms infinite
        `
      }}
    >
      {children}
    </div>
  );
}

export default function App() {
  const [files, setFiles] = useState([]);
  const [positions, setPositions] = useState({});
  const [mode, setMode] = useState("idle");

  async function scanDesktop() {
    const result = await window.electron.invoke("scan-desktop");
    setFiles(result);

    const scatter = {};
    result.forEach((f) => {
      scatter[f.path] = {
        x: Math.random() * 900,
        y: Math.random() * 500
      };
    });

    setPositions(scatter);
    setMode("scatter");

    setTimeout(() => setMode("migrate"), 700);
  }

  const groups = useMemo(() => groupFiles(files), [files]);

  const groupCenters = useMemo(() => {
    const centers = {};
    Object.keys(groups).forEach((group, i) => {
      centers[group] = {
        x: 150 + i * 280,
        y: 200
      };
    });
    return centers;
  }, [groups]);

  return (
    <div style={{ padding: 20, fontFamily: "sans-serif" }}>
      <button onClick={scanDesktop}>Scan Desktop</button>

      <div
        style={{
          position: "relative",
          width: "100%",
          height: "650px",
          marginTop: 20
        }}
      >
        {Object.entries(groups).map(([group, items]) =>
          items.map((f, idx) => {
            const base = positions[f.path] || { x: 0, y: 0 };
            const center = groupCenters[group];

            const col = idx % 3;
            const row = Math.floor(idx / 3);

            const targetX = center.x + col * 110;
            const targetY = center.y + row * 70;

            const x = mode === "migrate" ? targetX : base.x;
            const y = mode === "migrate" ? targetY : base.y;

            return (
              <FadeItem
                key={f.path}
                group={group}
                delay={idx * 40}
                style={{
                  position: "absolute",
                  transform: `translate(${x}px, ${y}px)`,
                  transition: "transform 0.9s ease"
                }}
              >
                {f.name}
              </FadeItem>
            );
          })
        )}
      </div>
    </div>
  );
}
