import React from 'react';
import { Stack } from 'expo-router';

export default function LockLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'fade',
        // Lock screen should not allow gestures to dismiss
        gestureEnabled: false,
      }}
    >
      <Stack.Screen name="index" />
    </Stack>
  );
}
