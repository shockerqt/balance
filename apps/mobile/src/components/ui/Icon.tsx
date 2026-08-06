import React from 'react';
import { Lucide } from '@react-native-vector-icons/lucide';
import { useTheme } from '@/theme';

/* ============================================================
   Iconos del sistema.

   Se usa el set Lucide, el mismo de los mockups del sandbox: lo que
   se aprueba ahi es literalmente lo que se ve en el telefono, sin
   traducir iconos por el camino.

   Va como fuente y no como SVG, asi que no arrastra react-native-svg
   y rinde mejor en listas largas. El grosor de trazo queda fijo en el
   del diseño de Lucide.
   ============================================================ */

type Tone = 'primary' | 'secondary' | 'muted' | 'accent' | 'danger' | 'onPrimary';

export interface IconProps {
  /** Nombre en kebab-case del set Lucide: "chevron-down", "trash-2". */
  name: React.ComponentProps<typeof Lucide>['name'];
  size?: number;
  tone?: Tone;
  /** Color explicito; gana sobre `tone`. */
  color?: string;
}

export const Icon: React.FC<IconProps> = ({ name, size = 18, tone = 'secondary', color }) => {
  const theme = useTheme();

  const resolved =
    color ??
    {
      primary: theme.colors.text,
      secondary: theme.colors.textSecondary,
      muted: theme.colors.textMuted,
      accent: theme.colors.primary,
      danger: theme.colors.danger,
      onPrimary: theme.colors.onPrimary,
    }[tone];

  return <Lucide name={name} size={size} color={resolved} />;
};
