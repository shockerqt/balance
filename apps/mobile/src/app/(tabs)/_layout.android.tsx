import { Stack } from 'expo-router/stack';
import { View } from 'react-native';
import { useTheme } from '@/theme';
import { gradientBackground } from '@/theme/gradient';
// Compose retains primary navigation; Expo tools share the same resolved theme.
export default function AndroidLayout() {
  const theme = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background } }}>
    <Stack.Screen name="library" options={{ headerShown: true, title: 'Biblioteca', headerTintColor: theme.colors.text,
      headerBackground: () => <View style={[{ flex: 1 }, gradientBackground(theme.gradients.header)]} /> }} />
  </Stack>;
}
