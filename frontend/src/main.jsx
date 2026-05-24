// src/main.jsx - FINAL FIXED ROUTER

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import AppMES from "./App_MES.jsx";   // Dashboard Layout
import Overview from "./pages/Overview.jsx";
import Machines from "./pages/Machines.jsx";
import MachineDetail from "./pages/MachineDetail.jsx";
import AiDecision from "./pages/AiDecision.jsx";
import Copilot from "./pages/Copilot.jsx";


import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>


      {/* Main Dashboard Layout */}
      <Route path="/" element={<AppMES />}>
        <Route index element={<Overview />} />
        <Route path="overview" element={<Overview />} />
        <Route path="machines" element={<Machines />} />
        <Route path="machines/:id" element={<MachineDetail />} />
        <Route path="ai-decision" element={<AiDecision />} />
        <Route path="copilot" element={<Copilot />} />
      </Route>

    </Routes>
  </BrowserRouter>
);
