// =====================================
// Ultra v15 — App_MES.jsx (FINAL FIXED)
// Dashboard Layout (Navbar + Router Outlet)
// =====================================

import React, { createContext, useState, useCallback } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";

export const LayerContext = createContext();

export default function AppMES() {
  const navigate = useNavigate();
  const [layer, setLayer] = useState("ILD");

  const logout = useCallback(() => {
    localStorage.removeItem("token");
    navigate("/login");
  }, [navigate]);

  return (
    <LayerContext.Provider value={{ layer, setLayer }}>
      <div className="min-h-screen bg-[#0f172a] text-slate-200">

        {/* ===== NAVIGATION BAR ===== */}
        <div className="flex justify-between items-center px-6 py-4 bg-[#0b1120] border-b border-white/5">

          {/* Left: brand identity only (logo + title) */}
          <div className="flex items-center gap-3">
            <div className="w-1 h-7 rounded-full bg-blue-400" />
            <div className="text-xl font-bold tracking-wide text-white">
              FAB MES Scrap Dashboard
            </div>
          </div>

          {/* Right: primary nav → data layer → logout */}
          <div className="flex items-center gap-5">
            {/* Primary nav — solid button pills */}
            <nav className="flex items-center gap-3">
              {[
                { to: "/", end: true, label: "Overview" },
                { to: "/machines", end: false, label: "Machines" },
                { to: "/ai-decision", end: false, label: "AI Decision" },
              ].map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `px-4 py-2 rounded-lg text-sm font-medium border transition-all duration-150 active:scale-95 ${
                      isActive
                        ? "bg-blue-500 border-blue-400 text-white shadow-md shadow-blue-500/30"
                        : "bg-slate-800/80 border-slate-700/70 text-gray-300 hover:bg-slate-700 hover:border-slate-600 hover:text-white"
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>

            {/* Separator */}
            <div className="w-px h-6 bg-white/10" />

            {/* Data Layer — context selector */}
            <div className="flex items-center gap-2.5">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                Layer
              </span>
              <div className="flex items-center gap-2">
                {["ILD", "PSG", "STI"].map((l) => (
                  <button
                    key={l}
                    onClick={() => setLayer(l)}
                    className={`px-3 py-2 rounded-lg border text-sm transition-all duration-150 active:scale-95 ${
                      layer === l
                        ? "bg-blue-500/10 border-blue-400/60 text-blue-200 font-semibold shadow-sm shadow-blue-500/20"
                        : "bg-slate-800/60 border-slate-700/60 text-gray-400 hover:bg-slate-700 hover:text-gray-200"
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {/* Separator */}
            <div className="w-px h-6 bg-white/10" />

            <button
              onClick={logout}
              className="px-4 py-2 bg-red-800/90 border border-red-700/60 text-white text-sm rounded-lg hover:bg-red-700 hover:border-red-600 transition-all duration-150 active:scale-95"
            >
              Logout
            </button>
          </div>
        </div>

        <div className="p-4">
          <Outlet />
        </div>

      </div>
    </LayerContext.Provider>
  );
}
