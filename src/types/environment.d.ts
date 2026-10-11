/// <reference types="expo/types" />
/// <reference types="uniwind/types" />

// Make clean checkouts typecheck before Metro generates its local declarations.
declare module 'uniwind' {
  export interface UniwindConfig {
    themes: readonly ['light', 'dark'];
  }
}

export {};
