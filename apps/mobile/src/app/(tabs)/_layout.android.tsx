import { Stack } from 'expo-router/stack';
import { View } from 'react-native';
import { useTheme } from '@/theme';
// The React Native shell owns primary navigation; tools keep their stack header.
export default function AndroidLayout() {
  const theme = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background } }}>
    <Stack.Screen name="library" options={{ headerShown: true, title: 'Biblioteca', headerTintColor: theme.colors.text,
      headerShadowVisible: false, headerBackground: () => <View style={{ flex: 1, backgroundColor: theme.colors.background }} /> }} />
  </Stack>;
}
