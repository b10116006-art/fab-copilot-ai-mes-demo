// MachinesMatrix.jsx - Ultra v13
// - 顯示每個 layer 的機台矩陣
// - 資料來源：GET /machines/state?layer=ILD|PSG|STI

import React from "react";
import useMESData from "../hooks/useMESData";

const API_BASE =
  (import.meta?.env?.VITE_API_BASE_URL &&
    String(import.meta.env.VITE_API_BASE_URL).trim()) ||
  (import.meta?.env?.VITE_API_BASE && String(import.meta.env.VITE_API_BASE).trim()) ||
  "http://127.0.0.1:5000";

const STATUS_COLOR = {
  RUN: "#1abc9c",
  WARN: "#f1c40f",
  ALERT: "#e74c3c",
  UNKNOWN: "#7f8c8d",
};

function MachineCard({ machine }) {
  const status = machine.status || "UNKNOWN";
  const color = STATUS_COLOR[status] || STATUS_COLOR.UNKNOWN;

  return (
    <div
      style={{
        borderRadius: 8,
        padding: "8px 10px",
        border: `1px solid ${color}`,
        background:
          status === "RUN"
            ? "rgba(26, 188, 156, 0.08)"
            : status === "WARN"
            ? "rgba(241, 196, 15, 0.08)"
            : status === "ALERT"
            ? "rgba(231, 76, 60, 0.08)"
            : "rgba(127, 140, 141, 0.08)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 4 }}>
        {machine.machine || machine.machine_id}
      </div>
      <div style={{ fontSize: 12, opacity: 0.85 }}>Status: {status}</div>
      <div style={{ fontSize: 12, opacity: 0.85 }}>
        Confirmed: {machine.confirmed ?? 0} / Pending: {machine.pending ?? 0}
      </div>
      <div style={{ fontSize: 12, opacity: 0.65 }}>
        Events: {machine.events ?? 0}
      </div>
    </div>
  );
}

export default function MachinesMatrix({ layer = "ILD" }) {
  const { data, loading, error } = useMESData(`${API_BASE}/machines/state?layer=${layer}`);

  if (loading) {
    return <div style={{ padding: 8 }}>載入機台資料中…</div>;
  }

  if (error) {
    return (
      <div style={{ padding: 8, color: "#e74c3c" }}>
        機台資料載入失敗：{String(error)}
      </div>
    );
  }

  const machines = (data && data.machines) || [];

  if (!machines.length) {
    return <div style={{ padding: 8 }}>這個 layer 目前沒有機台資料。</div>;
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
        gap: 8,
      }}
    >
      {machines.map((m) => (
        <MachineCard key={m.machine_id || m.machine} machine={m} />
      ))}
    </div>
  );
}
