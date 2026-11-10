/*
 * Tipi minimi di libheif-js (WebAssembly incorporato nel modulo), per la
 * parte usata in src/lib/upload/heic.ts. Il pacchetto non li dichiara.
 */
declare module "libheif-js/libheif-wasm/libheif-bundle.mjs" {
  export type HeifImage = {
    get_width(): number;
    get_height(): number;
    is_primary(): boolean;
    display(target: ImageData, done: (result: ImageData | null) => void): void;
    free(): void;
  };
  export type LibHeif = {
    ready?: Promise<unknown>;
    HeifDecoder: new () => { decode(data: Uint8Array): HeifImage[] };
  };
  export default function libheif(options?: Record<string, unknown>): LibHeif;
}
