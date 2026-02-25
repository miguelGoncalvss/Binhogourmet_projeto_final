import { FormEvent, useState } from "react";
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

export default function FirstAccess() {
  const navigate = useNavigate();
  const currentUser = authStorage.getUser();

  const [email, setEmail] = useState(currentUser?.email || "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!email.trim()) {
      setError("Informe o novo e-mail.");
      return;
    }

    if (password.length < 6) {
      setError("A nova senha deve ter pelo menos 6 caracteres.");
      return;
    }

    if (password !== confirmPassword) {
      setError("As senhas não conferem.");
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post("/auth/first-access", {
        email: email.trim(),
        password,
      });

      authStorage.setUser(data.user);
      authStorage.setMustChangePassword(false);

      navigate("/", { replace: true });
    } catch (err: any) {
      setError(err?.response?.data?.error || "Erro ao atualizar acesso.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/20 px-4">
      <Card className="w-full max-w-md border shadow-lg">
        <CardHeader>
          <CardTitle>Primeiro acesso</CardTitle>
          <CardDescription>
            Atualize seu e-mail e senha para continuar usando o sistema.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label className="mb-1 block text-sm font-medium">Novo e-mail</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seuemail@dominio.com"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Nova senha</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Confirmar senha</label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repita a senha"
              />
            </div>

            {error ? (
              <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Salvando..." : "Salvar e continuar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}