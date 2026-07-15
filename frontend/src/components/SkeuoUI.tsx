// 通用拟物化组件
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'brass' | 'rubber' | 'chrome' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg';

interface SkeuoButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  children: ReactNode;
  fullWidth?: boolean;
}

const variantClass: Record<ButtonVariant, string> = {
  brass: 'skeuo-btn-brass',
  rubber: 'skeuo-btn-rubber',
  chrome: 'skeuo-btn-chrome',
  outline: 'skeuo-btn-chrome',
};

const sizeClass: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs gap-1.5',
  md: 'px-5 py-2.5 text-sm gap-2',
  lg: 'px-7 py-3.5 text-base gap-2.5',
};

export function SkeuoButton({
  variant = 'chrome',
  size = 'md',
  icon,
  children,
  fullWidth = false,
  className = '',
  ...rest
}: SkeuoButtonProps) {
  return (
    <button
      {...rest}
      className={`
        ${variantClass[variant]}
        ${sizeClass[size]}
        ${fullWidth ? 'w-full' : ''}
        inline-flex items-center justify-center
        rounded-lg
        cursor-pointer
        select-none
        uppercase
        tracking-wider
        transition-all
        font-sans
        ${className}
      `}
    >
      {icon && <span className="inline-flex items-center">{icon}</span>}
      <span>{children}</span>
    </button>
  );
}

// 拟物化卡片
interface SkeuoCardProps {
  children: ReactNode;
  className?: string;
  variant?: 'paper' | 'leather';
}

export function SkeuoCard({ children, className = '', variant = 'paper' }: SkeuoCardProps) {
  const baseClass = variant === 'paper' ? 'skeuo-panel' : 'skeuo-leather';
  return (
    <div className={`${baseClass} rounded-2xl p-4 ${className}`}>
      {children}
    </div>
  );
}

// 拟物化 Tab 按钮
interface SkeuoTabProps {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}

export function SkeuoTab({ active, onClick, children, className = '' }: SkeuoTabProps) {
  return (
    <button
      onClick={onClick}
      className={`
        skeuo-cassette-tab
        px-3 py-1.5
        ${active ? 'active' : ''}
        ${className}
      `}
    >
      {children}
    </button>
  );
}

// 拟物化 LED 数字
interface SkeuoLEDProps {
  value: string | number;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const ledSize = {
  sm: 'text-base px-2 py-0.5',
  md: 'text-2xl px-3 py-1',
  lg: 'text-4xl px-4 py-2',
  xl: 'text-6xl px-5 py-3',
};

export function SkeuoLED({ value, size = 'md', className = '' }: SkeuoLEDProps) {
  return (
    <span className={`skeuo-led inline-block ${ledSize[size]} ${className}`}>
      {value}
    </span>
  );
}

// 拟物化进度条
interface SkeuoProgressProps {
  value: number;
  variant?: 'success' | 'warn' | 'danger' | 'auto';
  className?: string;
}

export function SkeuoProgress({ value, variant = 'auto', className = '' }: SkeuoProgressProps) {
  const autoVariant = variant === 'auto'
    ? (value >= 80 ? 'success' : value >= 60 ? 'warn' : 'danger')
    : variant;

  return (
    <div className={`skeuo-progress-track ${className}`}>
      <div
        className={`skeuo-progress-fill ${autoVariant === 'success' ? '' : autoVariant}`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

// 拟物化 Pro 徽章
export function SkeuoProBadge() {
  return <span className="skeuo-pro-badge">PRO</span>;
}

// 拟物化难度星
interface SkeuoStarsProps {
  level: number;
  max?: number;
}

export function SkeuoStars({ level, max = 5 }: SkeuoStarsProps) {
  return (
    <span className="inline-flex items-center gap-0.5 text-xs">
      {Array.from({ length: max }).map((_, i) => (
        <span key={i} className={i < level ? 'skeuo-star' : 'text-stone-400 opacity-40'}>
          ★
        </span>
      ))}
    </span>
  );
}

// 拟物化标题（含副标题）
interface SkeuoHeadingProps {
  title: string;
  subtitle?: string;
  variant?: 'light' | 'dark';
}

export function SkeuoHeading({ title, subtitle, variant = 'light' }: SkeuoHeadingProps) {
  const titleClass = variant === 'light' ? 'skeuo-engrave' : 'skeuo-engrave-dark';
  return (
    <div className="space-y-0.5">
      <h2 className={`${titleClass} text-lg leading-tight`}>{title}</h2>
      {subtitle && (
        <p className={`text-xs ${variant === 'light' ? 'text-amber-100/80' : 'text-stone-500'}`}>
          {subtitle}
        </p>
      )}
    </div>
  );
}
