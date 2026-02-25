import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./components/layout/ProtectedRoute";
import FirstAccessRoute from "./components/layout/FirstAccessRoute";
import LayoutWrapper from "./components/layout/LayoutWrapper";

import Login from "./pages/Login";
import FirstAccess from "./pages/FirstAccess";
import Dashboard from "./pages/Dashboard";
import Inventory from "./pages/Inventory";
import Recipes from "./pages/Recipes";
import POS from "./pages/POS";
import Finance from "./pages/Finance";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route element={<FirstAccessRoute />}>
          <Route path="/first-access" element={<FirstAccess />} />
        </Route>

        <Route element={<ProtectedRoute />}>
          <Route element={<LayoutWrapper />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/recipes" element={<Recipes />} />
            <Route path="/pos" element={<POS />} />
            <Route path="/finance" element={<Finance />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}