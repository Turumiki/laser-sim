declare module 'imagetracerjs' {
  const ImageTracer: {
    imagedataToSVG(img: ImageData, options?: Record<string, unknown>): string;
  };
  export default ImageTracer;
}
