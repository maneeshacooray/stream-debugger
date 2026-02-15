import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useStreamConfig } from '../config/streams';
import { useAppTheme } from '../constants/appTheme';

export default function RootLayout() {
  const { settings } = useStreamConfig();
  const theme = useAppTheme(settings.themeMode);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
          <Stack.Screen name="index" />
        </Stack>
        <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
