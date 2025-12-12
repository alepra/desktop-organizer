import { useState, useEffect, useMemo } from "react";
import { groupFiles } from "./logic/groupFiles";
import { getGroupColor } from "./logic/colors";
import "./FadeItem.css";
import "./TestAnimation.css";

function FadeItem({ children, delay, group }) {
  return (
    <div
      className="fade-item"
      style={{
        animation: `fadeLift 0.45s ease ${delay}ms`,
        boxShadow: `0 0 0 4px ${getGroupColor(group)}`
      }}
    >
      {children}
    </div>
  );
}

function makeKey(group, file, index) {
  return `${group}__${file.name}__${index}`;
}

export default function App() {
  const [files, setFiles] = useState([]);

  useEffect(() => {
    console.log("FILES UPDATED:", files);
  }, [files]);

  async function scanDesktop() {
    console.log("SCAN CLICKED");
    const result = await window.electron.invoke("scan-desktop");
    console.log("SCAN RESULT FILES:", result);
    setFiles(result);
  }

  const groups = useMemo(() => groupFiles(files), [files]);

  const [testStyle, setTestStyle] = useState({
    width: "50px",
    height: "50px",
    background: "red",
    opacity: 0,
    transition: "opacity 1s ease",
  });

  useEffect(() => {
    setTimeout(() => {
      setTestStyle((prev) => ({
        ...prev,
        opacity: 1,
      }));
    }, 1000);
  }, []);

  return (
    <div style={{ padding: 20, fontFamily: "sans-serif" }}>
      <div className="test-box"></div>
      <button onClick={scanDesktop}>Scan Desktop</button>

      <div style={{ marginTop: 20 }}>
        {files.length === 0
          ? "No files scanned yet."
          : Object.entries(groups).map(([group, items], idx) => (
              <div key={group} style={{ marginBottom: "20px" }}>
                <div style={{
                  fontWeight: "bold",
                  marginBottom: "6px",
                  fontSize: "16px"
                }}>
                  {group.toUpperCase()}
                </div>

                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  {items.map((f, itemIndex) => (
                    <FadeItem key={makeKey(group, f, itemIndex)} delay={itemIndex * 40} group={group}>
                      {f.name}
                    </FadeItem>
                  ))}
                </div>
              </div>
            ))}
      </div>
    </div>
  );
}
