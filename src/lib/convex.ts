import { ConvexReactClient } from 'convex/react';

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;

if (!convexUrl) {
  console.warn('EXPO_PUBLIC_CONVEX_URL is not set. Convex calls will fail until it is configured.');
}

export const convex = new ConvexReactClient(convexUrl ?? 'https://invalid.convex.cloud');
