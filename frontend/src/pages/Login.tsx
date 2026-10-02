import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Eye, EyeOff, Lock, LogIn, Mail } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getBackendBaseUrl } from '@/lib/storage';
import { UserRole } from '@/types/dashboard';
import { hasPermission } from '@/lib/permissions';

const getDashboardHomeForRole = (role: UserRole) => {
  if (role === 'admin') return '/dashboard';
  const roleUser = { id: '', role };
  if (hasPermission(roleUser as any, 'traffic', 'read')) return '/dashboard/trafego';
  if (role === 'closer') return '/dashboard/resgate';
  if (hasPermission(roleUser as any, 'commercial', 'read')) return '/dashboard/comercial';
  if (role === 'gestor') return '/dashboard/trafego';
  if (role === 'closer') return '/dashboard/resgate';
  return '/dashboard/comercial';
};

export default function Login() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [code, setCode] = useState('');
  const [needs2fa, setNeeds2fa] = useState(false);
  const [erro, setErro] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { login, user, isReady } = useAuth();
  const navigate = useNavigate();

  const [bootstrapChecked, setBootstrapChecked] = useState(false);
  const [needsAdminSetup, setNeedsAdminSetup] = useState(false);
  const [setupNome, setSetupNome] = useState('Administrador');
  const [setupEmail, setSetupEmail] = useState('admin@mail.com');
  const [setupSenha, setSetupSenha] = useState('');
  const [setupSenha2, setSetupSenha2] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [setupErro, setSetupErro] = useState('');
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupDone, setSetupDone] = useState(false);

  useEffect(() => {
    const backend = getBackendBaseUrl();
    if (!backend) {
      setBootstrapChecked(true);
      return;
    }

    fetch(`${backend}/api/auth/bootstrap`)
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) return null;
        return data;
      })
      .then((data) => {
        setNeedsAdminSetup(Boolean(data?.needsAdmin));
        setBootstrapChecked(true);
      })
      .catch(() => {
        setBootstrapChecked(true);
      });
  }, []);

  useEffect(() => {
    if (!isReady) return;
    if (!user) return;
    navigate(getDashboardHomeForRole(user.role), { replace: true });
  }, [isReady, user, navigate]);

  const handleSetupAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSetupErro('');

    const backend = getBackendBaseUrl();
    if (!backend) {
      setSetupErro('Servidor não Configurado');
      return;
    }

    if (!setupNome.trim()) {
      setSetupErro('Informe o nome do administrador');
      return;
    }
    if (!setupCode.trim()) {
      setSetupErro('Informe o código de instalação exibido no terminal do backend');
      return;
    }
    if (!setupEmail.trim()) {
      setSetupErro('Informe o e-mail do administrador');
      return;
    }
    if (!setupSenha) {
      setSetupErro('Informe a senha do administrador');
      return;
    }
    if (setupSenha.length < 8) {
      setSetupErro('A senha deve ter pelo menos 8 caracteres');
      return;
    }
    if (setupSenha !== setupSenha2) {
      setSetupErro('As senhas não coincidem');
      return;
    }

    setSetupLoading(true);
    try {
      const res = await fetch(`${backend}/api/auth/bootstrap/admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Bootstrap-Token': setupCode.trim() },
        body: JSON.stringify({ nome: setupNome, email: setupEmail, senha: setupSenha }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Erro ao criar o administrador');

      setSetupDone(true);
      setSetupCode('');
      setNeedsAdminSetup(false);
      setEmail(setupEmail);
      setSenha(setupSenha);

      const result = await login(setupEmail, setupSenha);
      if (result.ok) {
        navigate('/dashboard');
      }
    } catch (error: any) {
      setSetupErro(String(error?.message || 'Erro ao criar o administrador'));
    } finally {
      setSetupLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');
    setNeeds2fa(false);
    setIsLoading(true);
    try {
      const result = await login(email, senha, code || undefined);
      if (result.ok) {
        navigate('/dashboard');
      } else {
        if (result.requiresTwoFactor) {
          setNeeds2fa(true);
          setErro('Informe o código 2FA para continuar');
        } else {
          setErro(result.error || 'Usuário ou senha incorretos');
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="dark min-h-screen flex flex-col items-center justify-center bg-background text-foreground relative overflow-hidden p-4 sm:p-6">
      {/* Ambient background glow for a premium feel */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[40%] -left-[20%] w-[80%] h-[80%] rounded-full bg-primary/15 blur-[120px]" />
        <div className="absolute -bottom-[40%] -right-[20%] w-[80%] h-[80%] rounded-full bg-primary/5 blur-[120px]" />
      </div>

      <Dialog open={bootstrapChecked && needsAdminSetup && !setupDone}>
        <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Primeiro acesso</DialogTitle>
            <DialogDescription>Crie o usuário administrador para começar a usar o sistema.</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSetupAdmin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="setup-code">Código de instalação</Label>
              <Input
                id="setup-code"
                type="password"
                value={setupCode}
                onChange={(e) => setSetupCode(e.target.value)}
                autoComplete="off"
                disabled={setupLoading}
                required
              />
              <p className="text-xs text-muted-foreground">Copie o código exibido no terminal do backend ao iniciar o servidor.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="setup-nome">Nome</Label>
              <Input
                id="setup-nome"
                type="text"
                value={setupNome}
                onChange={(e) => setSetupNome(e.target.value)}
                disabled={setupLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="setup-email">E-mail</Label>
              <Input
                id="setup-email"
                type="email"
                value={setupEmail}
                onChange={(e) => setSetupEmail(e.target.value)}
                autoComplete="email"
                disabled={setupLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="setup-senha">Senha</Label>
              <Input
                id="setup-senha"
                type={showPassword ? 'text' : 'password'}
                value={setupSenha}
                onChange={(e) => setSetupSenha(e.target.value)}
                autoComplete="new-password"
                disabled={setupLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="setup-senha2">Confirmar senha</Label>
              <Input
                id="setup-senha2"
                type={showPassword ? 'text' : 'password'}
                value={setupSenha2}
                onChange={(e) => setSetupSenha2(e.target.value)}
                autoComplete="new-password"
                disabled={setupLoading}
              />
            </div>

            {setupErro && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {setupErro}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={setupLoading}>
              {setupLoading ? 'Criando...' : 'Criar administrador'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <div className="w-full max-w-md z-10 space-y-8 animate-fade-in">
        <div className="flex flex-col items-center justify-center text-center space-y-4">
          <img
            src="/logo.png"
            alt="Golden Life"
            className="w-36 h-36 object-contain brightness-0 invert"
          />
          <div className="space-y-1">
            <h2 className="text-[1.625rem] leading-tight font-semibold tracking-tight text-foreground">
              Bem-vindo
            </h2>
            <p className="text-muted-foreground text-sm">
              Informe suas credenciais para acessar sua conta
            </p>
          </div>
        </div>

        <div className="bg-card/70 border border-border backdrop-blur-xl rounded-2xl p-6 sm:p-8 shadow-raised space-y-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-foreground/80">Usuário</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="text"
                  placeholder="seu.usuario"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  required
                  className="pl-10 h-11 bg-background/60 border-input text-foreground placeholder:text-muted-foreground/60 focus-visible:ring-primary focus-visible:border-primary"
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="senha" className="text-foreground/80">Senha</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="senha"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  autoComplete="current-password"
                  required
                  className="pl-10 pr-10 h-11 bg-background/60 border-input text-foreground placeholder:text-muted-foreground/60 focus-visible:ring-primary focus-visible:border-primary"
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground/80 transition-colors"
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {needs2fa && (
              <div className="space-y-2">
                <Label htmlFor="code" className="text-foreground/80">Código 2FA</Label>
                <Input
                  id="code"
                  type="text"
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="h-11 bg-background/60 border-input text-foreground focus-visible:ring-primary"
                  disabled={isLoading}
                  required
                />
              </div>
            )}

            {erro && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {erro}
              </div>
            )}

            <Button type="submit" size="lg" className="w-full h-11 mt-2 font-medium" disabled={isLoading}>
              <LogIn className="mr-2 h-4 w-4" />
              {isLoading ? 'Iniciando sessão...' : 'Iniciar sessão'}
            </Button>
          </form>


        </div>

        <p className="text-center text-xs text-muted-foreground/60">
          © {new Date().getFullYear()} Lab Sistemas. Todos os direitos reservados.
        </p>
      </div>
    </div>
  );
}
