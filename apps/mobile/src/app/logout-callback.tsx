import React from 'react';
import { Redirect } from 'expo-router';

// The owning auth operation validates its browser return. This route never
// reads, adopts or exchanges credentials from a deep link.
export default function LogoutCallbackScreen() {
  return <Redirect href="/login" />;
}
