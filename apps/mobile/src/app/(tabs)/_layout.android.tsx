import { Stack } from 'expo-router/stack';

// The Compose host owns the four destinations and central registration action.
export default function AndroidLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#111315' } }}>
    <Stack.Screen name="library" options={{ headerShown: true, title: 'Biblioteca', headerStyle: { backgroundColor: '#1b1e22' }, headerTintColor: '#eef0f2' }} />
  </Stack>;
}
