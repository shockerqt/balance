import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { makeStyles } from '@/theme';
import { Icon } from './Icon';
import { Text } from './Text';

/* ============================================================
   Hoja del router.

   Cabecera sobre el fondo: boton de volver (44, superficie con
   borde, radio 14), titulo 22 y subtitulo 13, y una accion opcional a
   la derecha. El pie es una barra de superficie con borde superior.
   ============================================================ */

export interface SheetProps {
  title: string;
  subtitle?: string;
  /** Hace el subtitulo tocable: sirve para abrir un selector. */
  onSubtitlePress?: () => void;
  /** Accion a la derecha del titulo. */
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
  const router = useRouter();
  const close = onClose ?? (() => router.back());

  const subtitleNode = subtitle ? (
    <Text variant="caption" tone={onSubtitlePress ? 'accent' : 'secondary'}>
      {subtitle}
    </Text>
  ) : null;

  return (
    <View style={styles.sheet}>
      <View style={styles.header}>
        <TouchableOpacity onPress={close} accessibilityRole="button" accessibilityLabel={closeLabel} style={styles.back}>
          <Icon name="chevron-left" size={20} tone="primary" />
        </TouchableOpacity>
        <View style={styles.titleBlock}>
          <Text variant="title" numberOfLines={1}>{title}</Text>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.md,
    paddingHorizontal: t.space.xl,
    paddingTop: t.space.lg,
    paddingBottom: t.space.md,
  },
  back: {
    width: 44,
    height: 44,
    borderRadius: t.radius.md,
    borderWidth: t.border.hairline,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: { flex: 1, minWidth: 0 },
  body: { flex: 1 },
  footer: {
    paddingHorizontal: t.space.xl,
    paddingTop: t.space.md,
    paddingBottom: 18,
    borderTopWidth: t.border.hairline,
    borderTopColor: t.colors.border,
    backgroundColor: t.colors.surface,
  },
}));
