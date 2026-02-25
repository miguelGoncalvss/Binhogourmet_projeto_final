import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { authStorage } from "../services/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";

export default function Login() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("binho@local");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = authStorage.getToken();
    if (!token) return;

    if (authStorage.getMustChangePassword()) {
      navigate("/first-access", { replace: true });
    } else {
      navigate("/", { replace: true });
    }
  }, [navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { data } = await api.post("/auth/login", { email, password });

      authStorage.setToken(data.token);
      authStorage.setUser(data.user);
      authStorage.setMustChangePassword(!!data.must_change_password);

      if (data.must_change_password) {
        navigate("/first-access", { replace: true });
      } else {
        navigate("/", { replace: true });
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || "Falha no login.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/20 px-4">
      <Card className="w-full max-w-md border shadow-lg">
        <CardHeader>
          <CardTitle>Binho Gourmet</CardTitle>
          <CardDescription>Login do sistema</CardDescription>
        </CardHeader>

        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label className="mb-1 block text-sm font-medium">E-mail</label>
              <Input
                type="text"
                placeholder="binho@local"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Senha</label>
              <Input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error ? (
              <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Entrando..." : "Entrar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}