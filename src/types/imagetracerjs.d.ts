// imagetracerjs ships no TypeScript types; minimal declarations for the
// two entry points the tracer tool uses.
declare module 'imagetracerjs' {
  export interface ImageDataLike {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  }
  export function imagedataToSVG(
    imgd: ImageDataLike,
    options?: Record<string, number | boolean | string>
  ): string;
  export function imagedataToTracedata(
    imgd: ImageDataLike,
    options?: Record<string, number | boolean | string>
  ): unknown;
}
