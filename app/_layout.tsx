import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack>
      {/* This loads your map full-screen and hides the top header bar */}
      <Stack.Screen name="index" options={{ headerShown: false }} />
    </Stack>
  );
}