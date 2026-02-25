import { Navigate, Outlet } from "react-router-dom";
import { authStorage } from "../../services/api";

export default function FirstAccessRoute() {
  const token = authStorage.getToken();
  const mustChange = authStorage.getMustChangePassword();

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (!mustChange) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}