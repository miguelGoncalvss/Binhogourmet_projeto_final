import { Link, NavLink, useNavigate } from "react-router-dom";
import { authStorage } from "../../services/api";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { CakeSlice, ChevronDown, LogOut } from "lucide-react";

const navItems = [
  { to: "/", label: "Dashboard" },
  { to: "/inventory", label: "Estoque" },
  { to: "/recipes", label: "Fichas Técnicas" },
  { to: "/pos", label: "PDV" },
  { to: "/finance", label: "Financeiro" },
];

export default function Topbar() {
  const navigate = useNavigate();
  const user = authStorage.getUser();

  const handleLogout = () => {
    authStorage.clearSession();
    navigate("/login");
  };

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="rounded-xl border p-2">
              <CakeSlice className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Gestão</p>
              <p className="text-base font-semibold leading-none">Binho Estrutura</p>
            </div>
          </Link>

          <div className="md:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  Menu
                  <ChevronDown className="ml-1 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {navItems.map((item) => (
                  <DropdownMenuItem key={item.to} asChild>
                    <NavLink to={item.to}>{item.label}</NavLink>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <nav className="hidden items-center gap-2 md:flex">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm transition ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center justify-between gap-2">
          <div className="hidden text-right md:block">
            <p className="text-sm font-medium">{user?.name || "Usuário"}</p>
            <p className="text-xs text-muted-foreground">{user?.email || "-"}</p>
          </div>

          <Button variant="outline" size="sm" onClick={handleLogout}>
            <LogOut className="mr-2 h-4 w-4" />
            Sair
          </Button>
        </div>
      </div>
    </header>
  );
}