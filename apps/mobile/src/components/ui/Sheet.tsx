import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { makeStyles, useTheme } from '@/theme';
import { gradientBackground } from '@/theme/gradient';
import { Icon } from './Icon';
import { Text } from './Text';

/* ============================================================
   Hoja del router.

   Abre con una regla gruesa, que es el recurso del lenguaje para
   iniciar un panel, y sobre `surface` en vez de `background`. Antes
   la hoja y la pantalla de atras compartian color, asi que no habia
   nada que separara una de otra al abrirse.
   ============================================================ */

export interface SheetProps {
  title: string;
  subtitle?: string;
  /** Hace el subtitulo tocable: sirve para abrir un selector. */
  onSubtitlePress?: () => void;
  /** Accion a la derecha del titulo. Por defecto, cerrar. */
  action?: React.ReactNode;
  onClose?: () => void;
  closeLabel?: string;
  /** Barra fija al pie, para la accion principal. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export const Sheet: React.FC<SheetProps> = ({
  title,
  subtitle,
  onSubtitlePress,
  action,
  onClose,
  closeLabel = 'Cerrar',
  footer,
  children,
}) => {
  const styles = useStyles();
  const theme = useTheme();
  const router = useRouter();
  const close = onClose ?? (() => router.back());

  const subtitleNode = subtitle ? (
    <Text variant="caption" tone={onSubtitlePress ? 'accent' : 'secondary'}>
      {subtitle}
    </Text>
  ) : null;

  return (
    <View style={styles.sheet}>
      <View style={styles.openingRule} />

      <View style={[styles.header, gradientBackground(theme.gradients.header)]}>
        <TouchableOpacity onPress={close} accessibilityRole="button" accessibilityLabel={closeLabel} style={{ minWidth: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="arrow-left" size={20} />
        </TouchableOpacity>
        <View style={styles.titleBlock}>
          <Text variant="title" style={{ fontSize: 21, fontWeight: '500' }}>{title}</Text>
          {onSubtitlePress ? (
            <TouchableOpacity accessibilityRole="button" onPress={onSubtitlePress} hitSlop={8}>
              {subtitleNode}
            </TouchableOpacity>
          ) : (
            subtitleNode
          )}
        </View>

        {action}
      </View>

      <View style={styles.body}>{children}</View>

      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
};

const useStyles = makeStyles((t) => ({
  sheet: { flex: 1, backgroundColor: t.colors.background },
  /** La regla que abre el panel. */
  openingRule: { height: 0, backgroundColor: t.colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.space.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 64,
    borderBottomWidth: 0,
    borderBottomColor: t.colors.border,
  },
  titleBlock: { flex: 1, gap: 2 },
  body: { flex: 1 },
  footer: {
    paddingHorizontal: t.space.xl,
    paddingTop: t.space.md,
    paddingBottom: t.space.xl,
    borderTopWidth: 0,
    borderTopColor: t.colors.text,
    backgroundColor: t.colors.surface,
  },
}));
