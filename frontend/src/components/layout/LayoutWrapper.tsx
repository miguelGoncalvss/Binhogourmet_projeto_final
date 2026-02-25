import { Outlet } from "react-router-dom";
import Topbar from "./Topbar";

export default function LayoutWrapper() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Topbar />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}