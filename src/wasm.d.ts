/** Vite serves the decoder's binary as a hashed asset from our own origin. */
declare module '*.wasm?url' {
  const url: string;
  export default url;
}
