import { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'primary' | 'info' | 'success' | 'warning';

const chipTone: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  primary: 'bg-primary/10 text-primary',
  info: 'bg-info/10 text-info',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
};

interface MetricCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  /** O número que o usuário veio ver: ganha superfície âmbar. Use um por tela. */
  featured?: boolean;
  /** Valores textuais (nome de produto/vendedor) usam tamanho menor que números. */
  text?: boolean;
  /** Valor herói maior, para o único número dominante da tela. */
  large?: boolean;
  className?: string;
}

/**
 * Cartão de métrica: rótulo (meta) → valor (herói) → dica (apoio).
 * Hierarquia por peso/tamanho/cor; a cor de status vive só no chip do ícone.
 */
export function MetricCard({ label, value, hint, icon: Icon, tone = 'neutral', featured, text, large, className }: MetricCardProps) {
  return (
    <Card
      className={cn(
        'overflow-hidden transition-[box-shadow,transform] duration-200 ease-out hover:shadow-raised',
        featured && 'border-transparent gradient-primary text-primary-foreground',
        className,
      )}
    >
      <CardContent className={cn('p-5', large && 'p-6')}>
        <div className="flex items-start justify-between gap-3">
          <p className={cn('eyebrow', featured && 'text-primary-foreground/70')}>{label}</p>
          {Icon && (
            <span
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                featured ? 'bg-primary-foreground/10 text-primary-foreground' : chipTone[tone],
              )}
            >
              <Icon className="h-4 w-4" />
            </span>
          )}
        </div>
        <div
          className={cn(
            'mt-3 font-semibold tabular-nums tracking-tight',
            text ? 'text-lg truncate' : large ? 'text-[2.5rem] leading-none tracking-tighter' : 'text-[1.75rem] leading-none',
          )}
        >
          {value}
        </div>
        {hint && (
          <div className={cn('mt-2 text-xs', featured ? 'text-primary-foreground/70' : 'text-muted-foreground')}>{hint}</div>
        )}
      </CardContent>
    </Card>
  );
}
